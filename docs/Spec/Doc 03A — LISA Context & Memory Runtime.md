# **Doc 03A — LISA Context & Memory Runtime**

**Version:** V3.0 **Status:** CANONICAL (supersedes V2.0) **Document family:** Doc 03 Preamble \+ Doc 03 Main V1.1 \+ Doc 03A (this document) \+ Doc 03B (API & Runtime Flow, pending V3) \+ Doc 03C (GCP Orchestration, pending V1) **Owners:** Lyceon Platform Team **Last updated:** 2026-04-23 **Supersedes:** Doc 03A V2.0 (2026-04-23). Prior draft "TUTOR\_CONTEXT\_AND\_MEMORY\_RUNTIME\_CONTRACT" — rebased as canonical Doc 03A V1; PDF-06 §5 "RAG Architecture" superseded in full (grounded retrieval semantics now governed by this document). **Depends on:** Doc 00 Platform Directive, Doc 01 V8 (Identity/Access/Billing/Guardian Trust), Doc 01A V1 (Platform Primitives), Doc 03 Main V1.1, Doc 02B V4, Doc 02C V4.

**V3 update scope:** Medium rebase against Doc 01 V8 \+ Doc 01A V1 (platform primitives canonical). No reversal of V2 architectural decisions; no behavior changes to core context resolution, memory model, or injection defense. What changes:

* **Entitlement (§15)** simplified to single-call pattern: LISA calls V8 `EntitlementService.canAccessFeature('tutor_access', studentId)`; §15 now specifies only LISA-specific mid-conversation degraded behavior. V8 §27.3 (including 01A abuse-tier check) is authoritative for the allow/deny decision.  
* **Abuse controls (§12A)** detection stays LISA-specific; enforcement delegated to 01A Part VI `AbuseScoreService`. Each detection emits `recordIncident({incidentType, severity})`; no duplicate scoring/tier logic. `tutor_injection_log` remains for LISA-specific detailed safety-review evidence.  
* **Memory refresh & scheduled jobs (§9, §19)** integration-layer update: GCP→API callbacks use 01A Part VII internal service auth (HMAC-SHA256 per service pair); logging/metrics follow 01A Part II conventions; failure envelopes use 01A §0.6 error classes.  
* **Observability (§19A)** rebased onto 01A Part II canonical logger \+ metrics \+ correlation IDs \+ PII redaction transport. LISA-specific SLOs preserved; generic observability conventions deferred to 01A.  
* **Config (scattered)** `tutor_context_config` renamed to `tutor_context_runtime_config` per 01A §8 naming convention. `tutor_injection_signatures` retains its name (pattern-data table, not a `*_runtime_config` scalar table).  
* **Caching (§8)** mastery reads explicitly adopt 01A Part III two-tier pattern with LISTEN/NOTIFY invalidation on mastery\_events writes.  
* **Schema governance (§17)** tutor table ownership classes cross-referenced to 01A Appendix D.

V1/V2 architectural decisions preserved. V3 changes are integration-layer, not behavior-layer. CR-03A-23 through CR-03A-30 appended.

---

# **Part 0 — Doc 03A Preamble**

## **0.1 Purpose**

Doc 03A defines how LISA resolves, persists, and uses context and memory during a conversation. It is the authoritative specification for:

* How LISA determines what it knows about the current question, session, student, and prior conversation  
* What data LISA is allowed to read and what it must never read  
* How short-term conversation history and durable memory interact  
* How hierarchical memory (compact summaries plus minimal structured facts) enables the "Knows Me" moments committed to in Doc 03 Main V1.1 §4.10  
* How the mastery read contract aligns with Doc 02C V4 without creating a second source of truth  
* How prompt injection defense is implemented at the context layer  
* How database tables persist canonical tutor runtime state

Doc 03A does not specify: API endpoints (Doc 03B), orchestration/model invocation (Doc 03C), persona behavior (Doc 03 Main §4), product modes (Doc 03 Main §5-6), or the runtime engines that produce the mastery events LISA reads (Doc 02B V4, Doc 02C V4).

## **0.2 Relationship to Doc 03 Main V1.1, Doc 01 V8, and Doc 01A V1**

Doc 03 Main is the source of truth when LISA-behavior conflicts arise. Doc 03A is the implementation-layer specification that honors Doc 03 Main's commitments. Doc 01 V8 and Doc 01A V1 provide the identity and platform primitive layers that 03A consumes.

**From Doc 03 Main V1.1, Doc 03A implements:**

* INV-03-01 through INV-03-19 at the context/memory/database layer  
* The "Knows Me" capability (§4.10) via `tutor_memory_summaries` schema and hybrid structured fields  
* The emotional register taxonomy (§4.11) via `tutor_instruction_assignments.reason_snapshot` logging  
* The 7-day soft-delete window (§14, §14.2) via retention metadata on all tutor tables  
* The anti-leak rules (§17) via context scrubbing and output boundary enforcement  
* The prompt injection defense (§18) via input isolation at the context layer

**From Doc 01 V8, Doc 03A consumes:**

* V8 `EntitlementService.canAccessFeature` (§27.3) for per-request LISA access check (§15)  
* V8 guardian trust model (§36) — zero guardian access architecturally enforced (§16)  
* V8 audit log conventions (§5.1) — PII redaction list extends to LISA content  
* V8 account deletion (§40) — tutor tables follow 7-day soft-delete window; hard-delete cron honors deletion request  
* V8 Appendix E ownership classes — tutor tables mapped in §17.4

**From Doc 01A V1, Doc 03A consumes:**

* 01A Part I config doctrine — `tutor_context_runtime_config` follows the `*_runtime_config` \+ LISTEN/NOTIFY pattern; `tutor_injection_signatures` remains as a pattern-data table, not a config table  
* 01A Part II observability — structured logger, correlation IDs, metrics naming, PII redaction transport  
* 01A Part III caching — two-tier topology \+ LISTEN/NOTIFY invalidation applied to mastery reads (§8)  
* 01A Part V `RateLimitLedger` — rate limit signals surfaced at context boundary (§12.7)  
* 01A Part VI `AbuseScoreService` — `recordIncident` emission for every LISA-detected abuse pattern (§12, §12A); `getScore` consulted at entitlement check  
* 01A Part VII internal service auth — HMAC for GCP→API memory compaction callbacks (§9), scheduled job callbacks (§19)  
* 01A §0.6 error classes — `CacheUnavailableError`, `AbuseScoreUnavailableError`, etc.

## **0.3 Supersession Notice**

**Superseded:** PDF-06 §5 "RAG Architecture" — the grounded retrieval model described there (priority: canonical question content, skill playbook, strategy snippets) is preserved in principle but replaced in specification by the context resolution order in §5 below and the allowed data source catalog in §4.

**Superseded:** Prior internal draft titled "TUTOR\_CONTEXT\_AND\_MEMORY\_RUNTIME\_CONTRACT" — rebased as Doc 03A V1. All content from the prior draft either appears here updated or is explicitly replaced by decisions from Doc 03 Main V1.1.

**Superseded by V3:** Doc 03A V2.0 is superseded by this document. V2's architectural decisions are preserved. V3 changes are integration-layer rebase against Doc 01 V8 (identity/entitlement) and Doc 01A V1 (platform primitives). See change records CR-03A-23 through CR-03A-30 for per-section rebase deltas.

**Not superseded:** Doc 02C V4 mastery engine, Doc 02B V4 runtime engines, Doc 01 V8 identity/entitlement, Doc 01A V1 platform primitives, PDF-06 §1-4 pedagogical principles (which Doc 03 Main §4 replaces with the LISA persona spec).

## **0.4 Version Terminology**

This document uses "V1" and "launch" interchangeably to denote the initial commercial release. The phrase "MVP" does not appear in Doc 03A because Lyceon has passed the MVP phase — V1 is a commercial launch, not a minimum viable product. Future targets are labeled "V2" (near-term post-launch) or "future target" (undated).

---

# **Part I — Core Principles**

## **§1 Core Principles**

LISA's context and memory behavior is governed by eight core principles. These reflect Doc 03 Main §3 and extend them with implementation-layer specifics.

### **1.1 Instructional, not authoritative**

LISA helps the student think. LISA does not act as the source of truth for scoring, mastery, entitlement, or any product state. The context layer enforces this by making all such data read-only to LISA and by routing write paths through canonical non-LISA owners (Doc 02B for session outcomes, Doc 02C for mastery, Doc 01 for entitlement).

### **1.2 Scoped first, broad second**

When LISA is launched from practice, review, or test review, context resolution starts from the current item or session. Dashboard entry is the broad fallback. This produces a predictable default: "LISA talks about the thing the student is looking at, unless the student explicitly asks about something else."

### **1.3 Server-authoritative context**

Every piece of context LISA uses — student identity, entitlement, role, session state, current question, mastery state, calendar — is resolved from authenticated server-side records. Client claims are inputs that may be validated, never trusted as the source of truth. This is INV-03-06.

### **1.4 No answer leakage**

Anti-leak rules apply to context as well as output. Pre-submit, the current question's `correct_answer` is filtered from any context payload LISA sees. Post-submit (in review-safe contexts), it becomes available. See §7 for the full context scrubbing rules.

### **1.5 One visible identity**

LISA emits one consistent identity. Internal variants (policy\_variants, emotional registers) modulate behavior but are never surfaced to students. The context layer logs variant selection to `tutor_instruction_assignments` but never includes variant names or rationales in context payloads that flow to the model's output path.

### **1.6 Policy decisions are logged**

Every material instructional decision — mode selection, policy\_variant choice, emotional register activation, similar-question offer, mode transition — is persisted to `tutor_instruction_assignments` with a compact `reason_snapshot`. This enables auditability, analytics, and debugging without exposing internals to students. See §11 for the logging contract.

### **1.7 Canonical question IDs are internal-only**

The SAT{M|RW}{1|2}\[A-Z0-9\]{6} canonical IDs may be stored in context payloads for retrieval and continuity, but they are never included in anything LISA outputs to students. This is INV-03-10, enforced at the output scanner (Doc 03C) and anchored here by keeping canonical IDs in internal-only context fields.

### **1.8 LISA does not write mastery**

LISA reads from the mastery tables in Doc 02C V4 to personalize context. LISA never writes to any mastery table, never invokes any mastery-writing RPC, and never emits events that would cause mastery to update. Retries that LISA guides the student toward flow through Doc 02B V4 runtime engines with canonical source\_family values (`practice`, `review`, `test`) — there is no `tutor` source\_family. This is INV-03-01.

---

# **Part II — Context Resolution**

## **§2 Entry Modes**

LISA opens in one of three entry modes. The entry mode determines initial context priority and allowed behavior.

### **2.1 scoped\_question**

**Triggered by:** Tutor launched from a specific question — practice question, review question, or full-length review question.

**Initial context priority:**

1. Current question in view (question row \+ canonical ID \+ metadata)  
2. Current session item (practice\_session\_items row, review\_session\_items row, or full\_length\_exam\_responses row)  
3. Recent tutor messages for the conversation (last N turns)  
4. Compact student teaching profile (tutor\_memory\_summaries of type `teaching_profile`)  
5. Broader relevant retrieval only if needed (skill playbook entries, pattern summaries)

**Rationale:** When a student opens LISA from a specific question, the highest-signal context is that question and its immediate session. Other context is supporting.

### **2.2 scoped\_session**

**Triggered by:** Tutor launched from a session shell without a single active question anchor — practice session overview, review session shell, test review shell.

**Initial context priority:**

1. Current session (practice\_sessions row, review\_sessions row, or full\_length\_exams row)  
2. Recent items in the session (last \~10 items with outcomes)  
3. Recent friction within the session (wrong answers, hint usage patterns, pauses)  
4. Recent tutor messages for the conversation  
5. Compact student teaching profile

**Rationale:** Session-scoped launches suggest the student wants to discuss the session as a whole rather than a single item. Session-wide patterns dominate.

### **2.3 general**

**Triggered by:** Tutor launched from dashboard or app shell with no question or session anchor.

**Initial runtime behavior:**

* Present bounded structured prompts/chips (per §6.4)  
* Allow freeform text input  
* Do not assume a topic until the student indicates direction

**Initial context priority (after student indicates direction):**

1. Student's prompt/chip selection  
2. Recent conversation turns if continuing an existing general conversation  
3. Compact teaching profile  
4. Broader learning context based on requested direction (recent practice history, recent exam results, calendar/study plan)

**Rationale:** General entry has the least signal from launch context. Chips provide bounded product-safe intents. Freeform text is accepted but processed through the injection defense layer before context expansion.

### **2.4 Entry mode immutability within a conversation**

Once a conversation is created with a specific `entry_mode`, that value is persisted on `tutor_conversations` and never changes. A conversation that started as `scoped_question` remains `scoped_question` for its entire lifetime, even if the student navigates away from the original question. This prevents mode confusion and keeps the context resolution path predictable.

If the student wants a different entry mode, they start a new conversation. The client is responsible for surfacing this option clearly in the UI.

## **§3 Source Surfaces**

Every tutor conversation records its source surface. Allowed values:

* `practice`  
* `review`  
* `test_review`  
* `dashboard`

The source surface determines:

* The initial context envelope  
* The set of allowed context data sources (§4)  
* The set of allowed tutor behaviors (§6)  
* Anti-leak rules per surface (§7)

Source surface is persisted on `tutor_conversations.source_surface` and never changes for the lifetime of the conversation. Like `entry_mode`, changing source requires a new conversation.

## **§4 Allowed Data Sources**

LISA may read from the following data sources, all student-scoped and subject to RLS policies enforcing `student_id = auth.uid()`:

### **4.1 Tutor-owned tables (full read/write for the student's own data)**

* `tutor_conversations` — conversation envelopes  
* `tutor_messages` — line-by-line conversation history  
* `tutor_memory_summaries` — durable compact summaries  
* `tutor_instruction_assignments` — policy decision log  
* `tutor_question_links` — question relationship log  
* `tutor_instruction_exposures` — rendered surface log

### **4.2 Runtime session data (read-only, scoped to student)**

* `practice_sessions`, `practice_session_items`, `practice_attempts` (from Doc 02B V4)  
* `review_sessions`, `review_session_items`, `review_error_attempts` (from Doc 02B V4)  
* `full_length_exams`, `full_length_exam_sections`, `full_length_exam_responses`, `full_length_exam_score_rollups` (from Doc 02B V4)

### **4.3 Mastery state (read-only; never write)**

* `student_skill_mastery` — current skill-level mastery  
* `student_domain_mastery` — current domain-level mastery  
* `student_section_projections` — current section projection bands  
* `student_kpi_rollups_current` — detailed per-skill-per-difficulty rollups  
* `student_mastery_weekly_snapshots` — weekly trend data  
* `mastery_events` — recent events (last 14 days) for "recently struggled" signals

See §8 for the full mastery read contract.

### **4.4 Calendar and study plan (read-only where relevant)**

* `study_plan_entries` (from future Doc 04\) — only loaded when entry mode is `general` and the student asks about planning, or when the conversation is within 7 days of a scheduled exam per the exam-day shift in Doc 03 Main §4.12

Study-plan context is not loaded by default for every scoped-question turn. See §5.2 for the relevance rule.

### **4.5 Canonical content (read-only; filtered by anti-leak)**

* `questions` — canonical question content  
* Question options, stem, explanation, skill/domain/difficulty metadata  
* Pre-submit: `correct_answer` and `explanation` are stripped from the context payload  
* Post-submit (review-safe contexts): full content available

### **4.6 Entitlement and identity (read-only, via V8 services)**

* `profiles` — student profile basics (student\_id, DOB for age check, country from billing address per INV-03-08, tier for entitlement per INV-03-03). Read per V8 §5 schema.  
* `entitlements` — current entitlement state. Authoritative access is via V8 `EntitlementService.canAccessFeature('tutor_access', studentId)` (V8 §27.3); raw table reads are not performed by LISA code paths.  
* Abuse score tier is consulted indirectly through V8 `EntitlementService`, which invokes 01A `AbuseScoreService.getScore` per V8 §27.3 step 7\. LISA does not read `abuse_scores` directly.

### **4.7 Explicitly forbidden reads**

LISA must not read from:

* Any other student's data (RLS enforces this architecturally per INV-03-14)  
* Guardian profile data or guardian-scoped views (per INV-03-05)  
* Payment/billing internals beyond what is required for the entitlement and country checks  
* Tutor conversations belonging to other students  
* Any system prompt, prompt template, or policy definition content (these live in Doc 03C orchestration, not in tables LISA reads)  
* Any admin, support, or audit log tables

## **§5 Context Resolution Order**

Context resolution is the process of building the context payload that will be sent to the orchestrator (Doc 03C) for model invocation. The order below applies to every tutor turn regardless of entry mode, with relevance filtering determining which layers actually load.

### **5.1 Resolution layers (in order)**

**Layer 1 — Entry scope.** The trusted launch object: source\_surface, source\_session\_id, source\_session\_item\_id, source\_question\_row\_id, source\_question\_canonical\_id. Always loaded.

**Layer 2 — Conversation history.** Recent tutor\_messages for the active conversation, up to a bounded window (default: last 12 turns, configurable via `tutor_context_runtime_config.recent_message_window`). Always loaded for continuing conversations.

**Layer 3 — Durable tutor memory.** Compact tutor\_memory\_summaries relevant to the current surface and scope. Types loaded per relevance:

* `teaching_profile` — always loaded if exists  
* `chat_compaction` — loaded when conversation exceeds recent window  
* `recent_learning_pattern` — loaded for scoped\_session and general entry modes  
* `study_context` — loaded when relevance rule §5.2 applies

**Layer 4 — Student learning context.** Server-resolved mastery and session data:

* Current mastery state for the active skill/domain/section (scoped\_question) or broader state (scoped\_session/general)  
* Recent session outcomes in the last 14 days  
* Recent friction signals (last 7 days of fails on the active skill or domain)  
* KPI rollups at the relevant granularity

**Layer 5 — Expansion retrieval.** Only when earlier layers are insufficient:

* Related past attempts on similar questions (via `tutor_question_links` history)  
* Similar questions from the canonical bank (by skill/domain/difficulty match)  
* Recent full-length patterns in the same area  
* Adjacent skill/domain context

### **5.2 Study-plan context relevance rule**

Study-plan context (Layer 3 type `study_context`, plus calendar reads from §4.4) is loaded only when at least one of the following is true:

* Entry mode is `general` AND the student's current turn asks about planning, workload, next steps, or what to study  
* The conversation is discussing recent workload, missed blocks, upcoming tests, or readiness  
* The conversation is proposing broader coaching beyond a single scoped question  
* The active policy\_variant is explicitly allowed to use study-context framing (logged in `tutor_instruction_assignments.reason_snapshot`)  
* The student has a `scheduled_exam_date` within 7 days, triggering the exam-day shift per Doc 03 Main §4.12

Study-plan context must not be loaded by default for every scoped-question turn. This prevents unnecessary context bloat and keeps scoped conversations focused.

### **5.3 No fail-open retrieval**

If scoped references are stale, missing, deleted, or unauthorized, context resolution must not fail open to unbounded broad retrieval. The fallback chain is:

1. Reuse the most recent valid scoped item in the same conversation if one exists  
2. Degrade to `scoped_session` if the source session still exists and is valid  
3. Degrade to `general` mode with an explicit student-facing fallback prompt

Any fallback path must be logged in `reason_snapshot.fallback_used` on the tutor\_instruction\_assignment for that turn.

### **5.4 Context payload envelope**

The output of context resolution is a structured envelope sent to Doc 03C orchestration:

{  
  "conversation\_id": "uuid",  
  "student\_id": "uuid",  
  "entry\_mode": "scoped\_question | scoped\_session | general",  
  "source\_surface": "practice | review | test\_review | dashboard",  
  "resolved\_scope": {  
    "source\_session\_id": "uuid | null",  
    "source\_session\_item\_id": "uuid | null",  
    "source\_question\_row\_id": "uuid | null",  
    "source\_question\_canonical\_id": "text | null",  
    "current\_question": { /\* canonical content, anti-leak-filtered \*/ }  
  },  
  "recent\_messages": \[ /\* last N turns \*/ \],  
  "memory\_summaries": \[ /\* relevant compact summaries \*/ \],  
  "memory\_structured\_fields": { /\* hybrid extraction fields per §10.3 \*/ },  
  "student\_learning\_context": {  
    "mastery\_snapshot": { /\* per §8 \*/ },  
    "recent\_friction": { /\* per §5.4.1 \*/ },  
    "kpi\_state": { /\* relevant rollups \*/ }  
  },  
  "study\_plan\_context": { /\* only if §5.2 triggers \*/ },  
  "policy\_assignment": { /\* mode, variant, register per §11 \*/ },  
  "runtime\_limits": {  
    "max\_output\_tokens": 600,  
    "timeout\_ms": 8000  
  }  
}

The context resolution layer is responsible for producing this envelope. Doc 03C orchestration consumes it. Doc 03B API enforces the envelope shape at the boundary.

#### **5.4.1 Recent friction signal**

`recent_friction` is a compact object summarizing recent struggle signals to inform LISA's tone and mode selection:

{  
  "consecutive\_fails\_this\_session": 0,  
  "consecutive\_fails\_this\_skill\_7d": 0,  
  "self\_deprecating\_language\_detected": false,  
  "long\_pause\_detected": false,  
  "mastery\_regression\_14d": null  
}

This signal feeds the emotional register selection per Doc 03 Main §4.11 and §4.14. It is computed at context resolution time from `tutor_messages`, `practice_session_items`, `review_error_attempts`, and `mastery_events`. It does not require a separate table.

## **§6 Context Restrictions by Surface**

Each source surface has specific rules for what LISA can do and what context must be filtered.

### **6.1 Practice surface**

**Pre-submit (current question not yet answered):**

* Allowed: hint, strategy, conceptual scaffolding  
* Forbidden: revealing correct answer, eliminating options to one, implying certainty about correctness  
* Context filter: `current_question.correct_answer = null`, `current_question.explanation = null`

**Post-submit (current question answered, student viewing result):**

* Allowed: explanation, step-by-step reasoning, similar-question offer, broader pattern reflection  
* Context filter: full question content including correct\_answer and explanation  
* Similar question offer must follow consent rule per §6.5

### **6.2 Review surface**

This is a primary LISA surface. Students come here specifically to understand missed questions.

* Allowed: explain the reviewed question, compare student's earlier reasoning to the correct reasoning, propose a similar or simpler question, widen to the skill/domain if helpful  
* Context filter: full question content is available (review surface is always post-submit relative to the original attempt)  
* Retry flow: if the student retries the question during review, the retry is a `review_pass` or `review_fail` event written to `review_error_attempts` by Doc 02B V4, not by LISA

### **6.3 Test review surface**

Full-length exam review, only available after the exam is completed.

* Allowed: explain completed test-review questions, discuss domains/skills from completed tests, propose related practice follow-up  
* Context filter: full question content available (test has ended, reveal is unlocked)  
* **Forbidden:** LISA is not available during the live full-length test UI per INV-03-02. The API layer (Doc 03B) blocks LISA requests when the student has an active, in-progress full-length exam session.

### **6.4 Dashboard/general surface**

LISA opens broad. Initial turn should ask the student to choose a direction.

**Recommended V1 chips (from Doc 03 Main §20):**

* Review my recent mistakes  
* Help with my last full-length  
* Explain a topic or skill  
* Help me decide what to study today  
* Ask a general question

These chips are product inputs stored in `tutor_prompt_chips` config (see §14.2), not hidden policy controls. Chip selections are passed as the first user turn content but do not override any anti-leak or scope rules.

### **6.5 Similar-question offer consent rule**

LISA may propose a similar question when one of the deterministic triggers in Doc 03 Main §4 or the prior draft §8.1 fires. The offer must be phrased as a student choice:

* "Want to try a similar one first?"  
* "Would it help if we step back and do an easier version of this pattern?"  
* "I can keep going on this one, or I can show you a related example. Which do you want?"

Silent pivots are forbidden. If the student accepts, the related question selection runs server-side and writes to `tutor_question_links`. The student sees only rendered question content, never the canonical ID.

---

# **Part III — Memory Model**

## **§7 Memory Layers**

LISA's memory operates at two layers: short-term conversation memory and durable memory. The hybrid structured extraction adds a minimal third layer sitting on top of durable memory.

### **7.1 Short-term memory**

**Source:** `tutor_messages` table, filtered to the active conversation.

**Window:** Default 12 most recent turns (configurable via `tutor_context_runtime_config.recent_message_window`, bounds 4–24).

**Content:** Each message includes role, content\_kind, message text, and optional scoped linkage fields (source\_session\_id, source\_session\_item\_id, source\_question\_row\_id, source\_question\_canonical\_id).

**Loading:** Always loaded for continuing conversations. For the first turn of a new conversation, the short-term memory is empty; the initial context comes entirely from entry scope, durable memory, and student learning context.

### **7.2 Durable memory**

**Source:** `tutor_memory_summaries` table, filtered to the student.

**Types (summary\_type enum):**

* `teaching_profile` — stable student learning profile (learning style signals, known strong/weak areas, preferred explanation depth)  
* `chat_compaction` — compressed historical conversation content when conversations exceed the short-term window  
* `recent_learning_pattern` — rolling summary of recent learning patterns (last \~30 days)  
* `study_context` — current study context (upcoming tests, current focus areas, plan adherence)

**Loading rules:** Per §5.1 Layer 3\. Summaries are loaded by type based on relevance to the current surface and entry mode.

**Content shape:** `tutor_memory_summaries.content_json` is a structured JSON object. V1 shapes are defined in Appendix A. All summaries are compact (target: \<500 tokens per summary) and structured rather than freeform prose.

### **7.3 Hybrid structured extraction (V1 scope)**

Per the Doc 03 Main V1.1 "Knows Me" commitment, V1 adds two structured fields to the durable memory layer. Full extraction of all patterns is V2.

**V1 structured fields (stored on `tutor_memory_summaries` rows of type `teaching_profile`):**

Inside `content_json`:

{  
  "last\_struggled\_skill": {  
    "canonical\_skill\_id": "text",  
    "domain": "text",  
    "section": "M | RW",  
    "last\_fail\_at": "timestamptz",  
    "fail\_count\_7d": "integer",  
    "mastery\_at\_time\_of\_fail": "numeric"  
  },  
  "last\_mastered\_skill": {  
    "canonical\_skill\_id": "text",  
    "domain": "text",  
    "section": "M | RW",  
    "crossed\_to\_strong\_at": "timestamptz",  
    "prior\_mastery": "numeric",  
    "current\_mastery": "numeric"  
  }  
}

These two fields are the minimum required to enable "Knows Me" moments like:

* "Last week linear equations were giving you trouble. Want to take another run at them, or start somewhere warmer?"  
* "Algebra's been your strength. Want me to throw some harder ones at you, or just warm up?"

**V1 extraction cadence:** These fields are updated as a side effect of the durable memory refresh job (§9) — they are derived from `mastery_events` and `student_skill_mastery` at the moment a memory summary is written or refreshed. No separate extraction pipeline is required at V1.

**V2 target:** Full structured extraction including `patterns_observed` (e.g., "tends to skip reading the question carefully"), `preferred_explanation_style` (e.g., "prefers visual reasoning for geometry"), and `test_day_readiness` composite. These require LLM-based pattern extraction over conversation history and are deferred to V2 when there is sufficient observed conversation data to train extraction prompts.

### **7.4 Memory retrieval and freshness**

**Retrieval policy:**

* Always prefer compact durable summaries plus recent conversation context over replaying large raw histories  
* Durable summaries older than 30 days are considered stale and flagged for refresh (§9)  
* When a summary is stale and a fresh summary is not yet available, LISA uses the stale summary but the context resolution logs `memory_freshness: stale` for observability

**Freshness thresholds (configurable via `tutor_context_runtime_config`):**

* `teaching_profile`: refresh every 14 days or when last\_struggled\_skill / last\_mastered\_skill significantly changes  
* `chat_compaction`: written at conversation close or when recent\_message window is exceeded  
* `recent_learning_pattern`: refresh every 7 days  
* `study_context`: refresh every 3 days or when scheduled\_exam\_date is within 14 days

### **7.5 Memory consent and opt-out**

V1 default: memory enabled for all Paid users. Students receive the "Knows Me" benefit automatically.

V2 target: per-student memory opt-out setting. A student who opts out will have LISA ignore durable memory summaries for their account and treat every conversation as freshly contextualized. Opt-out does not delete existing summaries; it suppresses retrieval. Delete-on-opt-out is a separate action covered by Doc 01 V8 account deletion flow (V8 §40).

V1 does not expose the opt-out UI. If a student requests it via support, ops can manually set an internal flag that suppresses memory loading. This is an escape valve, not a product feature.

### **7.6 Memory poisoning defense**

Memory is a target for prompt injection attacks: an attacker could attempt to write content to `tutor_memory_summaries` that, when later loaded, causes LISA to behave maliciously. Defenses:

**Layer A — Memory writer is trusted code only.** `tutor_memory_summaries` is only written by:

* The memory refresh job (§9), which operates on trusted server-side data  
* The GCP orchestrator compaction path (Doc 03C §10), which operates on already-scanned conversation content and writes back via the Doc 01A Part VII internal service auth path (HMAC-SHA256 signed callback; service pair `compaction-worker → main-api`)

No client-facing API allows direct writes to `tutor_memory_summaries`. The API (Doc 03B) has no student-writable memory endpoint. The GCP orchestrator cannot write without a valid HMAC signature matching an active secret in `service_auth_secrets` (01A §64); signature-verification failures are logged and rejected at the `/api/internal/memory/compact-writeback` route.

**Layer B — Schema constraints.** `tutor_memory_summaries.content_json` is validated against a JSON schema at write time (via a CHECK constraint or trigger). Only expected keys with expected value types are accepted. Free-form string fields are length-bounded.

**Layer C — Content scanning on read.** When summaries are loaded into a context payload, the content\_json is scanned for known injection signatures. Matches cause the summary to be dropped from the payload with a log event. Scan patterns are maintained in the orchestrator layer (Doc 03C).

**Layer D — Silent failure.** If a summary is dropped due to scanning, LISA proceeds with the remaining context. The student sees no indication that a summary was dropped. This prevents attackers from using memory content as a channel to confirm their injection succeeded (INV-03-13).

## **§8 Mastery Read Contract**

LISA reads mastery data to personalize context. This section defines exactly what LISA reads, what it never writes, and how the reads align with Doc 02C V4 semantics.

### **8.1 Read-only guarantee (INV-03-01)**

LISA never writes to any mastery table. Never invokes any mastery-writing RPC. Specifically forbidden invocations:

* `apply_learning_event_to_mastery`  
* `refresh_domain_mastery_for_student_domain`  
* `refresh_section_projection_for_student_section`  
* `refresh_weekly_mastery_snapshot`  
* Any function with `insert`, `update`, `upsert`, or `write` in the name that targets mastery tables

Retries that LISA guides the student toward flow through Doc 02B V4 runtime engines with canonical source\_family values (`practice`, `review`, `test`). There is no `tutor` source\_family in the mastery event taxonomy. If a student retries a question during a LISA conversation, the retry creates a session item through the normal practice or review flow, which calls the mastery RPC through Doc 02B, which writes to `mastery_events` and triggers all the downstream refreshes. LISA is not in the write path.

### **8.2 Allowed reads**

**Skill-level mastery:**

SELECT skill\_id, skill\_name, domain, section,  
       mastery\_score, mastery\_band, last\_event\_at,  
       has\_activity\_this\_week  
FROM student\_skill\_mastery  
WHERE student\_id \= $1  
  AND skill\_id \= $2;  \-- scoped  
\-- OR  
  AND domain \= $2;  \-- domain-scoped

**Domain-level mastery:**

SELECT domain, section, mastery\_score, mastery\_band,  
       weakest\_skill\_id, strongest\_skill\_id  
FROM student\_domain\_mastery  
WHERE student\_id \= $1;

**Section projections:**

SELECT section, projected\_band\_low, projected\_band\_high,  
       confidence\_level, last\_computed\_at  
FROM student\_section\_projections  
WHERE student\_id \= $1;

**KPI rollups (detailed per-skill-per-difficulty):**

SELECT skill\_id, difficulty, source\_family,  
       attempts\_count, correct\_count, pass\_rate  
FROM student\_kpi\_rollups\_current  
WHERE student\_id \= $1  
  AND skill\_id \= $2;

**Weekly snapshots (for trend context):**

SELECT week\_start\_date, mastery\_score, mastery\_band  
FROM student\_mastery\_weekly\_snapshots  
WHERE student\_id \= $1  
  AND skill\_id \= $2  
ORDER BY week\_start\_date DESC  
LIMIT 8;  \-- last 8 weeks

**Recent mastery events (for friction signals):**

SELECT skill\_id, domain, section, source\_family, is\_correct,  
       difficulty, event\_at  
FROM mastery\_events  
WHERE student\_id \= $1  
  AND event\_at \> now() \- interval '14 days'  
ORDER BY event\_at DESC  
LIMIT 50;

### **8.3 Mastery context payload shape**

The `student_learning_context.mastery_snapshot` field in the context envelope (§5.4) has this shape:

{  
  "scope": "skill | domain | section | all",  
  "current\_skill": {  
    "skill\_id": "text",  
    "domain": "text",  
    "section": "M | RW",  
    "mastery\_score": "numeric",  
    "mastery\_band": "not\_started | needs\_work | developing | proficient | strong",  
    "attempts\_14d": "integer",  
    "pass\_rate\_14d": "numeric",  
    "last\_event\_at": "timestamptz"  
  },  
  "current\_domain": {  
    "domain": "text",  
    "section": "M | RW",  
    "mastery\_score": "numeric",  
    "mastery\_band": "text"  
  },  
  "section\_projection": {  
    "section": "M | RW",  
    "projected\_band\_low": "integer",  
    "projected\_band\_high": "integer"  
  },  
  "recent\_activity\_summary": {  
    "skills\_practiced\_7d": \["text"\],  
    "skills\_with\_fails\_7d": \["text"\],  
    "skills\_newly\_mastered\_30d": \["text"\]  
  }  
}

Scope depends on entry mode. `scoped_question` loads `current_skill` and possibly `current_domain`. `scoped_session` loads broader domain view. `general` loads section-level and recent activity summaries.

### **8.4 Alignment with Doc 02C V4**

Doc 02C V4 defines the canonical mastery formula as pooled weighted pass-rate:

mastery\_score \= MIN(1.0, SUM(is\_correct × source\_weight × difficulty\_weight) / COUNT\_of\_events)

With source weights: `review=0.8, practice=1.0, test=1.5`. Difficulty weights (correct answers only): `easy=0.8, medium=1.0, hard=1.2`. Fails use flat 1.0. Half-life 3 weeks across weeks, 26-week lookback, decay baseline 0.1.

LISA reads the computed `mastery_score` and `mastery_band` values. LISA does not recompute mastery, does not interpret raw events into mastery independently, and does not project mastery trajectories using its own logic. If the mastery formula changes in a future Doc 02C version, LISA's reads automatically pick up the new values because LISA reads the computed columns, not raw events.

### **8.5 tutor\_question\_links and retry audit**

When LISA offers a similar question and the student accepts, the system writes to `tutor_question_links`:

INSERT INTO tutor\_question\_links (  
  id, student\_id, conversation\_id,  
  source\_question\_row\_id, source\_question\_canonical\_id,  
  related\_question\_row\_id, related\_question\_canonical\_id,  
  relationship\_type, difficulty\_delta, reason\_code,  
  link\_snapshot, created\_at  
) VALUES (...);

The student then sees the rendered related question. If they attempt it, the attempt creates a new practice\_session\_item or review\_session\_item through Doc 02B V4. The mastery event from that attempt is indistinguishable from any other event — it has source\_family `practice` or `review`, not `tutor`. The `tutor_question_links` row is the audit trail connecting the related question to its tutor origin.

This preserves INV-03-01 (LISA never writes mastery) while enabling audit ("which mastery events came from tutor-suggested retries?").

### **8.6 Mastery read caching (01A Part III)**

Mastery reads are hot-path: every LISA turn that personalizes context consults at minimum `student_skill_mastery` for the active skill and `student_domain_mastery` for the active domain. Naive per-turn DB reads would add 5-20ms to every turn. Doc 03A adopts the 01A Part III two-tier caching pattern for these reads.

**Cache keys (per 01A §25 convention):**

* `mastery:student:<uuid>:skill:<uuid>` — single-skill mastery snapshot  
* `mastery:student:<uuid>:domain:<domain>` — domain rollup  
* `mastery:student:<uuid>:section:<section>` — section projection  
* `mastery:student:<uuid>:recent_activity` — 7-day summary used for §5.4.1 friction signal

**Cache shape and TTL** (values in `caching_runtime_config`, defaults per 01A §A.1):

type MasteryCacheEntry \= CacheEntry\<MasterySnapshot\>;  // 01A §24  
// TTL: 60 seconds (soft)  
// Hard staleness: 300 seconds (5 minutes) — stale reads acceptable during DB outage

**Invalidation:** Doc 02B V4's mastery write path emits `NOTIFY mastery_invalidate '{"student_id":"<uuid>","skill_id":"<uuid>","domain":"<domain>"}'` after each `mastery_events` insert commits (01A §27 emission rule). The `tutor_context_reader` service listens on `mastery_invalidate` and drops the affected cache keys.

**Rationale — why this is not a new invalidation channel:** Doc 02C V4 already owns mastery writes; adding the NOTIFY is a small additive change in the write path rather than a new service. Consumers listening include LISA, the guardian dashboard projection, and Doc 02B's own read paths where applicable.

**Failure behavior:** If the LISTEN connection drops, LISA continues serving cached reads (soft TTL still applies). Reconnection per 01A §28 exponential backoff with jitter. If cache fetch fails and DB fetch fails past hard staleness, throw `CacheUnavailableError` (01A §0.6) — API layer (Doc 03B) maps to 503\.

**Launch target:** launch with caching enabled. Context-layer metrics (§19A) track cache hit rate; target P95 \>90% hit rate for in-conversation mastery reads.

---

# **Part IV — Structured Memory Schemas**

## **§9 Memory Refresh Job**

Durable memory summaries are maintained by a refresh job that runs periodically and on-demand. The job owns the V1 structured fields (last\_struggled\_skill, last\_mastered\_skill) along with the compact summaries.

### **9.1 Execution cadence**

* **Async nightly job:** Refreshes `recent_learning_pattern` and `study_context` summaries for all active students with activity in the last 7 days. Runs daily at 03:00 UTC (offset from the Doc 02C V4 weekly snapshot job at Monday 03:00 CT to avoid contention).  
* **On-demand (post-conversation-close):** Refreshes `chat_compaction` for conversations exceeding the recent\_message window. Executed by the GCP orchestrator per Doc 03C §10.  
* **On-demand (threshold-triggered):** Refreshes `teaching_profile` including V1 structured fields when any of the following fires:  
  * Student has a new skill cross into `strong` band in mastery  
  * Student has 3+ fails on a single skill within 24 hours  
  * 14 days have passed since last teaching\_profile refresh  
  * A full-length exam completes

### **9.2 Refresh ownership and SQL-vs-code boundary**

Per Doc 03C §10, the GCP orchestrator owns compaction execution. Supabase stores the resulting summary rows.

**SQL layer owns:**

* Schema constraints (required keys, types, bounds) enforced via CHECK constraints and triggers  
* Simple derived field queries (e.g., `MAX(event_at)` from `mastery_events` for a single student-skill)  
* Persistence — `INSERT ... ON CONFLICT ... UPDATE` patterns for upsert  
* Indexing and retrieval  
* RLS enforcement

**Application layer owns (not SQL):**

* Memory extraction heuristics and pattern recognition (e.g., "is this student self-deprecating?")  
* Classifier logic (emotional register detection, crisis signals)  
* Orchestration decisions (when to refresh which summary type for which student)  
* Dynamic relevance ranking for context layer loading  
* Complex cross-field semantic validation (e.g., "does this `last_mastered_skill` reflect a real mastery transition or a measurement artifact?")

**Boundary rule:** If a decision requires heuristics, thresholds subject to tuning, or pattern matching beyond simple field derivation, it lives in application code. The SQL function is a thin persistence wrapper that receives validated data and writes it.

The appendix C implementation is **illustrative of the expected SQL surface** — the actual extraction logic runs in a dedicated memory-refresh service invoked by the scheduled job (pg\_cron calls a Supabase Edge Function or webhook that runs the extraction in application code, then writes the result via the thin SQL persistence wrapper).

This split keeps SQL testable, migration-safe, and debuggable while keeping business logic where it belongs (version-controlled, unit-testable, deployable independently of DB schema changes).

### **9.3 Compaction failure behavior**

If compaction is unavailable (orchestrator down, job failure), LISA continues using:

* Recent `tutor_messages` (short-term memory still works)  
* Existing durable summaries (possibly stale)

LISA must not fail open into broad unbounded retrieval. Missing compaction degrades to a smaller recent-context window plus existing durable summaries. This is a soft degradation, not an error state.

If both compaction and existing summaries are unavailable for a given student (new student, never compacted), LISA operates with entry scope and short-term memory only. The conversation still works; it just has no "Knows Me" personalization until the first summary is written.

### **9.4 GCP→API callback integration (01A Part VII)**

Per Doc 03C, the GCP compaction worker computes compact summaries and writes them back to Supabase through the main API. That write path is internal service-to-service and uses 01A Part VII HMAC-SHA256 signing:

* **Service pair:** `compaction-worker → main-api`  
* **Secret loading:** `loadActiveSecret('compaction-worker', 'main-api')` from `service_auth_secrets` (01A §64)  
* **Signing string:** `METHOD\nPATH\nTIMESTAMP\nSHA256_OF_BODY` per 01A §62.1  
* **Callback endpoint:** `/api/internal/memory/compact-writeback` under reverse-proxy restriction (01A §69 — not publicly accessible)  
* **Rotation:** 90-day cadence with 14-day overlap window per 01A §65  
* **Verification failure:** signature-invalid requests return 401 per 01A §67; summary write is not performed; GCP worker retries per 01A §65.2 overlap validity during rotation

The API route handler receives the verified request, re-validates the student ownership and schema (§10.5 trigger still runs at the DB layer as a final structural safety net), and writes via the `tutor_memory_writer` role (§17.4).

### **9.5 Observability (01A Part II)**

Memory refresh job instrumentation follows 01A Part II conventions:

* Structured logger per 01A §11 with `service: "memory-refresh"` label  
* Correlation ID per job run (one `request_id` for the entire nightly batch; per-student child loggers inherit)  
* Metrics: `memory_refresh_student_count`, `memory_refresh_duration_ms`, `memory_refresh_failure_count` per 01A §15 naming convention  
* PII redaction: per 01A §14, memory summary content is never logged verbatim; only structural metadata (summary\_type, last\_refreshed\_at, student\_id hash)

Alert thresholds per 01A §18 routing: memory refresh failure \= Page; daily refresh duration \>30 min for baseline student count \= Warn.

## **§10 Structured Memory — V1 Schema**

### **10.1 teaching\_profile schema**

{  
  "summary\_version": "1.0",  
  "learning\_style\_signals": {  
    "prefers\_step\_by\_step": "boolean | null",  
    "prefers\_conceptual\_first": "boolean | null",  
    "responds\_well\_to\_analogies": "boolean | null",  
    "prefers\_quick\_explanations": "boolean | null"  
  },  
  "last\_struggled\_skill": {  
    "canonical\_skill\_id": "text | null",  
    "domain": "text | null",  
    "section": "M | RW | null",  
    "last\_fail\_at": "timestamptz | null",  
    "fail\_count\_7d": "integer | null",  
    "mastery\_at\_time\_of\_fail": "numeric | null"  
  },  
  "last\_mastered\_skill": {  
    "canonical\_skill\_id": "text | null",  
    "domain": "text | null",  
    "section": "M | RW | null",  
    "crossed\_to\_strong\_at": "timestamptz | null",  
    "prior\_mastery": "numeric | null",  
    "current\_mastery": "numeric | null"  
  },  
  "engagement\_summary": {  
    "typical\_session\_length\_min": "integer | null",  
    "days\_since\_last\_active": "integer | null",  
    "total\_tutor\_turns\_30d": "integer | null"  
  }  
}

Keys not listed above are forbidden in V1 and will be rejected by the schema check. This narrow schema is intentional — broader extraction is V2.

### **10.2 chat\_compaction schema**

{  
  "summary\_version": "1.0",  
  "conversation\_id": "uuid",  
  "source\_window\_start": "timestamptz",  
  "source\_window\_end": "timestamptz",  
  "turns\_compacted": "integer",  
  "topics\_discussed": \["text"\],  
  "skills\_referenced": \["text"\],  
  "key\_insights": \["text"\],  
  "unresolved\_confusion": \["text"\],  
  "last\_student\_direction": "text | null"  
}

`key_insights` and `unresolved_confusion` are bounded to 5 entries each, each entry under 200 characters. `topics_discussed` bounded to 10 entries. These bounds prevent compaction from growing unboundedly.

### **10.3 recent\_learning\_pattern schema**

{  
  "summary\_version": "1.0",  
  "window\_days": 30,  
  "sections\_active": \["M", "RW"\],  
  "skills\_improved": \[  
    {"skill\_id": "text", "mastery\_delta": "numeric"}  
  \],  
  "skills\_regressed": \[  
    {"skill\_id": "text", "mastery\_delta": "numeric"}  
  \],  
  "skills\_stuck": \[  
    {"skill\_id": "text", "fail\_count": "integer"}  
  \],  
  "attempts\_total": "integer",  
  "pass\_rate": "numeric"  
}

Bounded: `skills_improved`, `skills_regressed`, `skills_stuck` each to top 5 by magnitude.

### **10.4 study\_context schema**

{  
  "summary\_version": "1.0",  
  "scheduled\_exam\_date": "date | null",  
  "days\_until\_exam": "integer | null",  
  "current\_focus\_skills": \["text"\],  
  "plan\_adherence\_7d": "numeric | null",  
  "missed\_sessions\_7d": "integer | null",  
  "upcoming\_scheduled\_sessions": "integer"  
}

`scheduled_exam_date` comes from Doc 01 V8 / future Doc 04 (calendar). LISA reads it; LISA does not write it. The exam-day shift logic in Doc 03 Main §4.12 relies on this field being server-authoritative.

### **10.5 Schema enforcement — SQL trigger scope**

All four schemas above are enforced via a Postgres CHECK constraint on `tutor_memory_summaries.content_json` combined with `summary_type`. **The trigger enforces structural invariants only** — required keys present, types correct, count and size bounds respected, version string matches.

**The trigger does NOT enforce semantic validity.** Example:

* Trigger enforces: `last_struggled_skill` is an object with expected keys  
* Trigger does NOT enforce: the skill\_id actually exists in the questions schema, or the `last_fail_at` is a real event timestamp from `mastery_events`

Semantic correctness is the responsibility of the writing code (the memory refresh service). The trigger is a structural safety net, not a semantic validator.

This split is intentional per the SQL-vs-code boundary rule (§9.2). Complex semantic checks in triggers produce opaque migrations, hard-to-test logic, and painful schema evolution. Keep triggers simple; put semantic checks in the writer.

Implementation in Appendix B.

### **10.6 Future target — V2 extended schema**

V2 will add `patterns_observed`, `preferred_explanation_style`, `test_day_readiness`, and other fields. V2 schema will be additive — V1 fields will remain valid, and V1 readers will ignore unknown V2 fields. Summary\_version will bump to 2.0 for summaries written with V2 extractor. Doc 03A V2 update will specify the V2 schema.

## **§11 Policy Decision Logging**

Every material instructional decision is logged to `tutor_instruction_assignments`. This is INV-03-11.

### **11.1 What counts as a material decision**

Material decisions requiring a log entry:

* Mode selection (Hint / Explanation / Strategy / Review)  
* policy\_variant choice (concise / scaffolded / socratic / strategy\_first)  
* Emotional register activation (Default / Elite / Recovery / Sprint / Calm) — per Doc 03 Main §4.11  
* Similar-question offer  
* Broader-coaching offer  
* Mode transition mid-conversation  
* Fallback path activation (per §5.3)

Non-material runtime events (not logged to this table):

* Individual message turns (logged separately to `tutor_messages`)  
* Output scanner blocks (logged to observability, not instruction assignments)  
* Context layer internal decisions (what summaries to load, etc.)

### **11.2 Row shape**

tutor\_instruction\_assignments (  
  id, conversation\_id, student\_id, related\_message\_id,  
  source\_session\_id, source\_session\_item\_id,  
  source\_question\_row\_id, source\_question\_canonical\_id,  
  policy\_family,          \-- 'instructional\_tutor' at V1  
  policy\_variant,         \-- 'concise' | 'scaffolded' | 'socratic' | 'strategy\_first'  
  policy\_version,         \-- semantic version of the variant's prompt  
  prompt\_version,          \-- specific prompt template version  
  assignment\_mode,         \-- 'deterministic' | 'explore' | 'manual\_override'  
  assignment\_key,          \-- correlation key for analytics  
  emotional\_register,      \-- 'default' | 'elite' | 'recovery' | 'sprint' | 'calm'  
  reason\_snapshot,         \-- compact JSON per §11.3  
  created\_at  
)

### **11.3 reason\_snapshot contract**

`reason_snapshot` is a compact JSON object, bounded under 2KB. Expected keys:

{  
  "trigger\_type": "turn\_start | mode\_transition | similar\_question\_offer | fallback | register\_shift",  
  "source\_surface": "practice | review | test\_review | dashboard",  
  "entry\_mode": "scoped\_question | scoped\_session | general",  
  "scoped\_anchor": {  
    "session\_item\_id": "uuid | null",  
    "question\_canonical\_id": "text | null"  
  },  
  "policy\_inputs": {  
    "recent\_fails\_on\_skill": "integer",  
    "session\_turn\_number": "integer",  
    "self\_deprecating\_signal": "boolean",  
    "mastery\_band": "text"  
  },  
  "fallback\_used": "boolean",  
  "fallback\_reason": "text | null"  
}

Keep reason\_snapshot compact. Do not store large prompt bodies, raw chain-of-thought, or verbatim conversation content. Those have their own tables. reason\_snapshot is a decision audit trail, not a model-behavior log.

### **11.4 V1 policy family starter set**

* `policy_family`: `instructional_tutor` (all LISA instructional turns at V1)  
* `policy_variant` ∈ {`concise`, `scaffolded`, `socratic`, `strategy_first`}  
* `assignment_mode`: `deterministic` at V1 (chosen by rules, not explore/bandit)  
* `emotional_register` ∈ {`default`, `elite`, `recovery`, `sprint`, `calm`} per Doc 03 Main §4.11

V2 targets:

* `assignment_mode = explore` for A/B testing policy variants  
* Additional `policy_family` values for non-instructional conversations (e.g., metacognitive coaching)  
* Additional policy\_variants as pedagogical research informs

### **11.5 Logging failure behavior**

Per Doc 03 Main §18.2 and INV-03-11:

* Policy-assignment persistence failure is **blocking** for the turn. If the assignment can't be written, the tutor response is not returned.  
* Tutor message persistence failure is also blocking.  
* Non-critical exposure logging (`tutor_instruction_exposures`) may degrade with explicit error logging but must not silently claim success.

LISA must not produce an apparently successful instructional turn while silently dropping canonical logs. This is architecturally enforced by Doc 03B API turn flow: the API returns success only after all blocking writes complete.

### **11.6 Observability emission (01A Part II)**

Policy assignment writes emit structured log events via the 01A §11 logger interface:

logger.info('tutor\_policy\_assignment\_recorded', {  
  conversation\_id,  
  student\_id,                    // hashed per 01A §14 redaction  
  policy\_variant,  
  emotional\_register,  
  mode\_transition: boolean,  
  register\_shadow: boolean,      // per §14.8 Recovery/Elite shadow mode  
  request\_id                     // from 01A §12 correlation middleware  
});

Metrics emission per 01A §15 naming:

* `tutor_policy_assignment_count{variant, register, surface}` — counter  
* `tutor_policy_assignment_latency_ms{variant}` — histogram

`reason_snapshot` content is not emitted to logs; it lives only in the DB row. Per 01A §14, raw tutor prompts and responses are in the blocked-fields redaction list; the structured event above carries only the decision metadata, not the content.

---

# **Part V — Prompt Injection Defense at the Context Layer**

## **§12 Injection Defense Implementation**

Doc 03 Main §18 specifies five layers of prompt injection defense. Doc 03A implements Layer 3 (input content isolation) and supports Layer 4 (output scanning) and Layer 5 (rate limiting) at the context boundary.

### **12.1 Layer 1 recap — Architectural prevention**

Supabase RLS policies architecturally prevent cross-student data access (INV-03-14). A malicious user cannot make LISA read another student's data because RLS blocks the query at the database. This layer is owned by the schema (§14), not by runtime code.

### **12.2 Layer 2 recap — System prompt hard rules**

System prompt hard rules live in the orchestrator (Doc 03C). Doc 03A does not duplicate them. But the context layer supports Layer 2 by keeping the system prompt out of any context field that could flow through user-controlled channels.

### **12.3 Layer 3 — Input content isolation with boundary markers**

This is the primary Doc 03A defense. All student-generated content that enters the context payload is wrapped in boundary markers before being forwarded to the orchestrator.

**Boundary markers:**

\<student\_message\_content\>  
{{ student message text }}  
\</student\_message\_content\>

\<memory\_summary\_content type="teaching\_profile"\>  
{{ summary content }}  
\</memory\_summary\_content\>

\<session\_context\>  
{{ session data }}  
\</session\_context\>

The orchestrator's system prompt instructs the model to treat content within these tags as data, not instructions. Content outside the tags (system prompt, policy guidance) is the instructional frame.

**Pre-forwarding sanitization:**

Before wrapping in boundary markers, the context layer runs these checks on student-generated content:

1. **Tag pass-through check.** If the student's content contains strings matching `</student_message_content>` or similar closing tags, those strings are escaped (replaced with a sanitized variant that the orchestrator recognizes as escaped). This prevents the student from closing the boundary and injecting as instructions.

2. **Length bound.** Individual messages are bounded to 4000 characters. Longer messages are rejected at the API layer (Doc 03B) before reaching context resolution.

3. **Nested instruction detection.** Heuristic patterns that look like instructions ("ignore previous instructions", "you are now", "system:", "new rules:") are flagged. Flagged content is still forwarded but the `reason_snapshot.injection_flag = true` is set so the orchestrator can apply additional caution.

4. **Known attack signature scan.** A list of known injection attack signatures is maintained in `tutor_injection_signatures` config. Matches cause the turn to be rejected with a generic response (per Doc 03 Main §18, the rejection is silent from the student's perspective — the student sees a normal response that doesn't execute the injection, and the event is logged).

### **12.4 Memory content isolation**

Memory summaries loaded from `tutor_memory_summaries` are also wrapped in boundary markers. Even though memory is written by trusted server-side code (§7.6 Layer A), treating memory content as data rather than instructions provides defense in depth.

If an attacker somehow managed to write malicious content to a memory summary (e.g., through a compromised compaction job), the boundary markers prevent the model from executing it as instructions.

### **12.5 Canonical content isolation**

Canonical question content loaded from `questions` is also wrapped in boundary markers:

\<canonical\_question\_content\>  
{{ question stem, options, etc. }}  
\</canonical\_question\_content\>

This protects against the (theoretical) scenario where an attacker has written a question that contains injection content. Even if such content passed content review and entered the canonical bank, the boundary markers prevent it from being executed as instructions.

### **12.6 Layer 4 support — Output scanner inputs**

Doc 03C runs the output scanner. Doc 03A supports it by ensuring the context payload includes the full list of canonical patterns that must not appear in output:

* Current question's canonical\_id (per INV-03-10)  
* Current question's correct\_answer if pre-submit (per INV-03-04)  
* System prompt signatures (per INV-03-17)  
* Known policy\_variant names (should never appear in student-facing output)  
* Any other student's data (should be impossible per RLS, but scanner double-checks)

This list is passed to the orchestrator as `output_scan_blocklist`. The orchestrator uses it at the output boundary to reject any response that contains forbidden content, replacing it with a safe fallback response.

### **12.7 Layer 5 support — Rate limiting (01A Part V)**

Rate limit enforcement is owned by 01A Part V `RateLimitLedger`. LISA-relevant buckets include:

* `tutor_turns_daily` — per-day tutor turn quota (launch value 100, `rate_limit_runtime_config.bucket_definitions`)  
* `tutor_prompt_abuse_hourly` — rate limit on flagged turns (derived signal: more than N flagged turns in an hour tightens quota via abuse-score multiplier per 01A §42)

The context layer provides inputs used by `RateLimitLedger.checkAndIncrement`:

* `student_id`  
* `bucket_key`  
* optional `cost` parameter (flagged turns may count as cost \> 1 to tighten quota faster)

The context layer does not enforce quota — it surfaces signals. Doc 03B API layer calls `RateLimitLedger.checkAndIncrement` at the request boundary and returns 429 per 01A §44 response shape if denied. Abuse-score tier influences effective quota via 01A §42 multiplier (1.0× / 0.75× / 0.5× / 0.25× / 0× per tier).

### **12.8 Injection incident emission (01A Part VI)**

Per Q2=b decision: LISA-specific detection stays in 03A (context-aware patterns the generic 01A service cannot detect). Scoring and tier enforcement delegate to 01A `AbuseScoreService`. When Layer 3 detects an injection:

await abuseScoreService.recordIncident({  
  studentId,  
  incidentType: 'injection\_attempt',        // 01A §52 taxonomy  
  severity: 5,                              // triggers real-time recompute per 01A §54  
  context: {  
    signature\_matched: sig,  
    detection\_layer: 'layer\_3\_sanitization',  
    conversation\_id,  
    message\_id  
  }  
});

01A Part VI then handles the score update, tier transition, and cross-system propagation (quota tightening via §42 multiplier, entitlement tier check per V8 §27.3 step 7). 03A does not duplicate scoring logic; `tutor_injection_log` remains in 03A for LISA-specific detailed forensic evidence used by the safety review queue.

### **12.9 Silent handling (INV-03-13)**

When injection is detected at any layer, handling is silent from the student's perspective:

* No acknowledgment that injection was detected  
* No explanation of what was refused  
* No narration of the defense  
* Response continues normally on the nominal SAT topic or redirects if content is entirely off-topic

This is because acknowledgment gives attackers telemetry that helps them refine attacks. Silent handling forces attackers to test blindly.

Internal logging is verbose. Every injection detection writes both to `tutor_injection_log` (LISA-specific forensic evidence accessible to safety review queue per Doc 03 Main §21.3) and to `abuse_score_incidents` via `AbuseScoreService.recordIncident` (01A Part VI). These two logs serve different audiences: `tutor_injection_log` is LISA-specific detail (signature matched, response substituted); `abuse_score_incidents` is platform-wide incident signal for score computation.

---

# **Part V.5 — Abuse Controls Beyond Injection**

## **§12A Abuse Patterns and Defenses**

Injection defense (§12) addresses deliberate attempts to manipulate LISA behavior. This section addresses other abuse patterns that are not prompt injection but still degrade service quality, inflate cost, or violate platform policy.

**Division of labor per V3 rebase (Q2=b):** 03A detects LISA-contextual abuse patterns (patterns that require LISA-conversation context to recognize); 01A Part VI `AbuseScoreService` owns scoring, tier computation, and enforcement via the rate-limit multiplier path. Every detection in §12A emits `AbuseScoreService.recordIncident({studentId, incidentType, severity, context})`. 03A does not maintain its own scoring table, tier logic, or enforcement thresholds.

`tutor_injection_log` (§18.7) remains in 03A as LISA-specific forensic detail for the safety review queue (signature, detection layer, response substituted). `abuse_score_incidents` (01A §55) is the platform-wide incident ledger consumed by `AbuseScoreService.computeScore`.

### **12A.1 Retry storm detection**

**Pattern:** Client retries the same `client_turn_id` many times in quick succession, typically indicating a buggy client, a network path under attack, or a malicious actor attempting to exhaust quota.

**Detection (03A-owned):**

* Track retries of the same `client_turn_id` in a rolling 60-second window at the Doc 03B API boundary  
* Threshold: more than 5 retries of the same idempotency key → retry storm  
* Note: idempotency itself is handled via 01A Part IV `IdempotencyService` with `scope = 'tutor_turn'`; retries returning cached responses are expected normal behavior and do not constitute a "storm" until the threshold is exceeded

**Emission (delegated to 01A):**

await abuseScoreService.recordIncident({  
  studentId,  
  incidentType: 'retry\_storm',    // 01A §52 taxonomy  
  severity: 3,                     // per 01A §52 launch weights  
  context: { client\_turn\_id, retry\_count, window\_seconds: 60 }  
});

**Enforcement (01A-owned):**

* 01A Part V rate limiter enforces hard quota at Doc 03B API boundary; sustained retry storm from a single student triggers 429 denial per 01A §44  
* 01A Part VI scoring raises abuse tier; critical tier (score ≥ 81\) blocks tutor\_access entitlement per V8 §27.3 step 7

### **12A.2 Bot pattern detection**

**Pattern:** Request timing, message length distributions, and content patterns suggest automated generation rather than human interaction.

**Signals (03A-detected):**

* Inter-turn latency variance below expected human distribution (too regular)  
* Turn content exhibits templated patterns (same sentence structure, same token counts)  
* No typing-indicator events from client between turns (if client emits typing events)  
* Session length far outside human norms (e.g., 200+ turns in one hour sustained)

**V1 behavior:** classifier fires; no LISA-specific active response. Emission:

await abuseScoreService.recordIncident({  
  studentId,  
  incidentType: 'bot\_pattern\_signal',   // see taxonomy note below  
  severity: 3,  
  context: { signal\_type, confidence }  
});

**V2 target:** CAPTCHA challenge at next turn boundary (requires product surface change, punted).

**Taxonomy note:** 01A §52 launches with 12 incident types including `content_scraping`, `account_sharing_signal`, `quota_farming`, `tutor_prompt_abuse`. LISA-specific patterns without a pre-existing 01A type emit through the closest match or use `context.sub_type` for 03A-specific labeling. New incident types are added to 01A `abuse_score_runtime_config.base_weights` per 01A §52 governance. V3 does not unilaterally add new types; any 03A-specific type additions require 01A change record.

### **12A.3 Account sharing signals**

**Pattern:** One paid account being used by multiple humans in violation of ToS.

**Signals (03A-detected):**

* Geographic jumps inconsistent with realistic travel (e.g., conversations from US then 30 minutes later from Singapore)  
* Concurrent active sessions from different IP addresses  
* Distinct typing patterns, language patterns, or skill focus across conversations that don't cohere

**Emission:**

await abuseScoreService.recordIncident({  
  studentId,  
  incidentType: 'account\_sharing\_signal',   // 01A §52 taxonomy  
  severity: 4,  
  context: { signal\_type, confidence }  
});

**Enforcement:** severity 4 triggers real-time score recompute per 01A §54; persistent pattern elevates student to `high_risk` tier which applies 0.25× quota multiplier (01A §42). ToS enforcement (account suspension) remains a V8-governed identity action, triggered by support after manual review.

### **12A.4 Scraping pattern detection**

**Pattern:** Systematic progression through the question bank without signs of learning intent — e.g., a user who answers every question identically, doesn't pause to read, and seems to be attempting to extract content.

**Signals (03A-detected):**

* Very short time-per-question (\<3 seconds sustained)  
* No practice-before-LISA pattern (always opens LISA immediately on any question to extract explanation)  
* High breadth (touching many different skills) with zero depth (no revisit, no retry)  
* LISA turn content consists of "explain" / "what is the answer" type prompts without engagement

**Emission:**

await abuseScoreService.recordIncident({  
  studentId,  
  incidentType: 'content\_scraping',   // 01A §52 taxonomy — severity 4 base weight 20  
  severity: 4,  
  context: { scraping\_signal, questions\_in\_window }  
});

**Enforcement:** delegated to 01A. Repeated confirmed pattern elevates tier; score-weighted quota compression slows extraction rate; critical tier blocks tutor\_access.

### **12A.5 Quota farming**

**Pattern:** Automated minimum-effort LISA turns to appear active, typically to maintain some account status or exploit a promotion.

**Signals (03A-detected):**

* Turns with near-identical content ("hi", "ok", "thanks") at high frequency  
* No context engagement (doesn't reference current question, doesn't answer LISA's questions)  
* Activity concentrated at odd hours inconsistent with student's normal pattern

**Emission:**

await abuseScoreService.recordIncident({  
  studentId,  
  incidentType: 'quota\_farming',    // 01A §52 taxonomy  
  severity: 3,  
  context: { signal\_type, confidence }  
});

**Enforcement:** 01A quota multiplier reduces effective tutor\_turns\_daily limit; confirmed pattern escalates to ToS review per V8.

### **12A.6 Tutor prompt abuse (extraction attempts)**

**Pattern:** Repeated attempts to make LISA reveal internal prompts, policy variants, or system configuration. Distinguished from injection (§12) by being bounded within tutor dialogue norms (no malformed payload, just adversarial conversation).

**Signals (03A-detected):**

* Repeated questions like "what are your instructions", "what is your system prompt", "what persona are you"  
* Attempts to get LISA to role-play as a different system  
* Requests to output raw policy metadata

**Emission:**

await abuseScoreService.recordIncident({  
  studentId,  
  incidentType: 'tutor\_prompt\_abuse',   // 01A §52 taxonomy — severity 3 base weight 5  
  severity: 3,  
  context: { pattern\_matched }  
});

**Enforcement:** delegated to 01A; no LISA-specific enforcement. Repeated pattern raises tier.

### **12A.7 Repeated failure exploit**

**Pattern:** Attempting to exploit LISA's response to failure signals (Recovery register) by repeatedly submitting wrong answers to get easier content.

**Signals:**

* Consistently failing easy questions after demonstrating ability on hard ones  
* Submitting fails at intervals that optimally trigger Recovery register

**V1 scope:** not a priority; rely on mastery decay to neutralize fake-fail signal. No `recordIncident` emission at V1.

**V2 target:** classifier that detects the gaming pattern and suppresses Recovery trigger. When added, will emit `recordIncident` with a new 01A incident type pending 01A §52 taxonomy extension.

### **12A.8 Detection integration**

All LISA-detected abuse patterns emit `AbuseScoreService.recordIncident` and additionally log LISA-forensic detail to `tutor_injection_log` with specific `detection_layer` values:

* `retry_storm`  
* `bot_pattern`  
* `account_sharing`  
* `scraping_pattern`  
* `quota_farming`  
* `tutor_prompt_abuse`

The dual write is intentional:

* `abuse_score_incidents` (01A §55) — platform-wide, used for scoring and tier computation  
* `tutor_injection_log` (03A §18.7) — LISA-specific forensic detail for the safety review queue including signature\_matched, detection\_layer, response\_substituted

`tutor_injection_log` is not the platform abuse ledger; 01A owns that. It exists in 03A for detailed safety review evidence that would otherwise require joining multiple tables.

### **12A.9 Enforcement surfaces (01A-owned)**

LISA does not implement enforcement directly. The enforcement surfaces driven by `AbuseScoreService` scoring are:

| Surface | Mechanism | Reference |
| ----- | ----- | ----- |
| Quota compression | `RateLimitLedger` multiplier per tier | 01A §42 |
| Entitlement block (critical tier) | V8 `EntitlementService.canAccessFeature` step 7 | V8 §27.3 |
| Step-up auth for concerning tier | V8 identity flows | V8 §17A |
| Manual review escalation | Support tool, admin dashboard | V8 §44 \+ 01A §58 |
| Override path | `AbuseScoreService.adjustScore` per V8 §27.3.1 with 30-day respect window | 01A §56 |

03A contributes detection signals; 01A \+ V8 deliver enforcement. This keeps 03A focused on LISA-context detection and avoids duplicating policy logic that governs the whole platform.

---

# **Part VI — Mode Taxonomy at Runtime**

## **§13 Product Modes and Policy Variants — Orthogonal**

Per Doc 03 Main §5 and CR-03-05, product modes and internal policy\_variants are orthogonal. They combine at runtime to produce a specific instructional approach.

### **13.1 Product modes (student-facing concept)**

* **Hint** — nudge toward reasoning without revealing  
* **Explanation** — full explanation after submit  
* **Strategy** — test-taking strategy (time management, elimination, pacing)  
* **Review** — explain why the correct answer is correct after completion

Product modes appear in analytics and may appear in UI labels (e.g., "Hint mode"). They represent what the student experiences.

### **13.2 Policy variants (internal delivery style)**

* **concise** — brief, direct, low-token  
* **scaffolded** — step-by-step, building up  
* **socratic** — question-based, student does most of the thinking  
* **strategy\_first** — lead with strategy before content

Policy variants are internal. They are never surfaced to students. They are logged to `tutor_instruction_assignments.policy_variant`.

### **13.3 Orthogonality**

Any (mode, variant) combination is valid. Examples:

* Hint \+ concise: "Look at the coefficient of x."  
* Hint \+ scaffolded: "First, identify what the question is asking. Then look for..."  
* Explanation \+ socratic: "You chose B. What led you there? Now compare to C — what's different?"  
* Strategy \+ strategy\_first: "For pacing: aim for 90 seconds per RW question. Skip ones that..."

The runtime selects mode based on surface \+ context state (per §6, §13.5). The runtime selects variant based on student signals (per §13.4).

### **13.4 Variant selection signals**

**concise** selected when:

* Student signals time pressure ("quick question", "hurry", explicit request for brevity)  
* Sprint register active (per Doc 03 Main §4.11)  
* Student's typical session length is short (\<5 min from teaching\_profile.engagement\_summary)

**scaffolded** selected when:

* Student shows confusion signals (repeated hints requested, self-deprecating language)  
* Recovery register active  
* Student's mastery on the active skill is below `developing` band

**socratic** selected when:

* Student's mastery on the active skill is `proficient` or `strong`  
* Elite register active  
* No confusion signals

**strategy\_first** selected when:

* Source surface is practice or full-length and student is asking about pacing/elimination  
* Student explicitly asks about test-taking approach rather than content  
* Scheduled\_exam\_date within 14 days

If multiple variants are eligible, precedence order: recovery signals → sprint signals → elite signals → default to scaffolded.

### **13.5 Mode transitions and logging**

A mode transition within a conversation (e.g., Hint → Explanation after submit) is a material decision and is logged to `tutor_instruction_assignments` per §11. This is INV-03-15.

`reason_snapshot.trigger_type = mode_transition` with `reason_snapshot.mode_transition = {"from": "hint", "to": "explanation", "cause": "submit_detected"}`.

## **§14 Emotional Register Runtime**

Doc 03 Main §4.11 defines five emotional registers layered on top of policy\_variants. Doc 03A implements register selection at the context layer.

### **14.1 Register selection precedence**

Per Doc 03 Main §4.11, precedence order:

1. Crisis protocol (§21 in Doc 03 Main) overrides all others — handled at orchestrator layer, bypasses normal register selection  
2. Exam-day shift (§4.12 in Doc 03 Main) overrides default registers when `scheduled_exam_date` within 7 days  
3. Recovery signals override Elite triggers  
4. Sprint context overrides other signals when timed-practice surface  
5. Elite vs Default chosen by mastery threshold  
6. Calm as optional overlay on any register when anxiety detected

### **14.2 Recovery register triggers (strong)**

Per Doc 03 Main §4.14:

* 3+ consecutive incorrect attempts on the same skill in current session  
* Self-deprecating language detected in current turn  
* Mastery on active skill dropped \>0.15 in last 7 days  
* 14+ days inactive AND first-attempt in return session is incorrect

Recovery register is set, logged to `tutor_instruction_assignments.emotional_register = 'recovery'`. Deactivates when:

* 2 consecutive correct answers on the active skill  
* Student explicitly shifts topic  
* Student's language shifts from self-deprecating to engaged  
* Session ends

### **14.3 Elite register triggers**

* Student mastery on active skill \> 0.85 (strong band)  
* No confusion signals in last 5 turns  
* Fast-pace engagement (latencies consistent, no long pauses)

### **14.4 Sprint register triggers**

* Timed practice surface  
* Student explicit request ("quick", "fast", "just give me the answer approach")  
* Very short response latencies suggesting speed-focus

### **14.5 Calm register triggers**

* `scheduled_exam_date` within 7 days (per §4.12 Doc 03 Main)  
* Anxiety signals detected ("stressed", "nervous", "freaking out", "terrified")  
* Exam day itself

### **14.6 False positive handling**

Students discussing practice Reading passages about struggle, failure, or mental health may trigger Recovery signals falsely. The classifier distinguishes between student's own emotional state and content-topical discussion.

Distinguishing signal: if the self-deprecating language appears within a context where the student is paraphrasing or discussing passage content (detected by proximity to passage quotes or "the author says" phrases), Recovery is not activated.

False positives are logged to `tutor_injection_log` with trigger classification for later analysis. The classifier training data updates weekly based on these.

### **14.7 Register invisibility**

Registers are never surfaced to students:

* No UI indicator  
* No "Elite mode engaged" banner  
* No setting to manually select  
* No mention in tutor output

Students experience LISA as a consistent identity that adapts naturally. Internal logging captures the register for audit and analytics.

### **14.8 Evaluation harness and V1 launch gating**

Emotional register classifiers are not shipped without evidence of correctness. Register selection logic (especially Recovery and Elite triggers) is pattern-matching against student language and signals, which is prone to false positives that produce jarring tone shifts. A student discussing test-prep struggles academically should not trigger Recovery mode. A student working fast because they're rushing shouldn't trigger Elite.

**Required eval harness (V1 launch blocker for Recovery and Elite triggers):**

**Test set construction:**

* Seed test set: 200 labeled turn examples per register, derived from:  
  * Synthetic examples generated from Doc 03 Main §4.14 trigger specifications  
  * Beta user conversations with manual labels (post-launch; V1 bootstraps with synthetic)  
  * Adversarial examples (content that looks like a trigger but is topical — e.g., student discussing a passage about struggle)  
* Test set grows over time via false-positive-feedback from production runs

**Metrics tracked:**

* Precision per register: of turns where the classifier activated the register, what fraction were correct activations?  
* Recall per register: of turns where the register should have activated, what fraction did?  
* False positive rate: turns where register activated incorrectly  
* Confusion matrix: Recovery vs Default, Elite vs Default, etc.

**V1 launch gating thresholds:**

| Register | Precision threshold | Recall threshold | Launch gating |
| ----- | ----- | ----- | ----- |
| Default | n/a (baseline) | n/a | always active |
| Sprint | 85% | 70% | can launch at V1 (signal is explicit — student requests brevity) |
| Calm | 85% | 70% | can launch at V1 (signal is structural — `scheduled_exam_date` within 7 days) |
| Recovery | **90%** | 65% | **eval gate — must meet precision before enabling** |
| Elite | **90%** | 60% | **eval gate — must meet precision before enabling** |

Recovery and Elite have higher precision requirements because their failure modes are more user-visible: a student in Recovery mode who didn't need it feels patronized; a student in Elite mode who didn't earn it feels dismissed.

**Phased enablement:**

* **V1 Phase 1 (launch):** Default \+ Sprint \+ Calm active. Recovery and Elite implemented and logged (shadow mode — classifier runs and logs activation decisions but does not affect tone). This gathers real data without risking false-positive tone shifts on real users.

* **V1 Phase 2 (post-launch, \~week 4-6):** If shadow-mode Recovery classifier meets precision threshold over 2 weeks of real data, enable for a 10% canary. Measure thumbs-up/thumbs-down feedback and conversation completion rates. Expand to 100% if no regression.

* **V1 Phase 3 (post-launch, \~week 8-10):** Same pattern for Elite register.

* **V2:** Continuous eval cadence (weekly), automated regression detection on register precision, automatic rollback to shadow mode if precision drops below threshold.

**Ownership:** Product \+ ML Engineering jointly. Eval harness runs weekly and reports to the weekly LISA review cadence.

**Logging requirement:** Every shadow-mode register activation is logged to `tutor_instruction_assignments.reason_snapshot` with `register_shadow = true`. This preserves audit trail during the phased enablement without affecting production behavior.

---

# **Part VII — Entitlement and Access Control at Context**

## **§15 Per-Request Entitlement Check (INV-03-18)**

Per V3 rebase (Q3=b), §15 simplifies to a single-call pattern against V8's canonical entitlement service. V8 §27.3 (including 01A §50 abuse-tier check at step 7\) is authoritative for the allow/deny decision. This section specifies only LISA-specific behavior wrapping that decision.

### **15.1 The call**

At the context resolution boundary (before loading any student data beyond identity), LISA invokes:

const accessResult \= await entitlementService.canAccessFeature(  
  'tutor\_access',                // V8 feature identifier  
  studentId,  
  { request\_id, source\_surface } // optional context per V8 §27.3  
);

`canAccessFeature` returns per V8 §27.3:

type FeatureAccessResult \=  
  | { allow: true; reasons: string\[\] }  
  | { allow: false; reason: AccessDenialReason; retryableAt?: Date };

type AccessDenialReason \=  
  | 'not\_authenticated'  
  | 'wrong\_role'  
  | 'age\_below\_minimum'  
  | 'country\_not\_supported'  
  | 'no\_active\_entitlement'  
  | 'entitlement\_expired'  
  | 'abuse\_score\_lockout'      // 01A §50 critical tier  
  | 'manual\_suspension';

V8 §27.3 step semantics are fully authoritative. 03A does not re-check age, country, tier, or abuse score directly — that all happens inside `canAccessFeature`.

### **15.2 Translation to LISA behavior**

| `canAccessFeature` outcome | LISA behavior |
| ----- | ----- |
| `allow: true` | Proceed with context resolution |
| `allow: false, reason: no_active_entitlement` | Context resolution returns `access_denied`; Doc 03B API translates to 402 Payment Required |
| `allow: false, reason: entitlement_expired` | Same as above; 402 |
| `allow: false, reason: age_below_minimum` | 403 Forbidden; existing conversation preserved for 7 days per retention matrix |
| `allow: false, reason: country_not_supported` | 403 |
| `allow: false, reason: abuse_score_lockout` | 403 with generic message per §12.8 silent handling rule — never reference abuse score or tier in student-facing response (01A §57 no-visibility rule) |
| `allow: false, reason: manual_suspension` | 403 generic |
| `allow: false, reason: wrong_role` | Should not happen for LISA (guardians blocked architecturally per §16); treat as 403 \+ log as security event |

### **15.3 Mid-conversation entitlement changes**

If `canAccessFeature` returns `allow: false` mid-conversation (e.g., Stripe webhook fires, abuse-score tier escalates, entitlement expires), the next tutor read/write boundary re-checks and blocks. V3 makes the re-check source-explicit: every turn calls `canAccessFeature`. LISA does not cache the allow decision across turns.

**LISA-specific graceful degradation:**

* Student sees a message appropriate to the denial reason (generic "access unavailable" for abuse lockout per §15.2 rule)  
* Existing conversation history remains stored for 7 days per Doc 01 V8 §40 soft-delete window and Doc 03 Main §14.2  
* If the block is transient (e.g., brief webhook lag), retry path works naturally on next turn once `canAccessFeature` re-resolves to allow

**Rationale for no grace period:** inherits V8 §27.3 binary semantics. Any 03A-level grace period would conflict with V8's canonical decision and create a revenue leak vector. Transient webhook delays are handled by the student's next retry.

### **15.4 Service unavailability**

If `canAccessFeature` itself throws (DB unavailable, abuse-score fetch fails past hard staleness):

* `AbuseScoreUnavailableError` (01A §0.6) → V8 §27.3 fail-closed behavior is authoritative; LISA honors the resulting denial  
* `CacheUnavailableError` (01A §0.6) → same, fail closed  
* Generic timeout → 503 Service Unavailable per Doc 03 Main §26.A Failure Mode Matrix; student sees "Verifying your account, please try again."

LISA does not override V8's fail-closed posture. Retries resolve once the check succeeds. The context layer fails closed consistently with Doc 03 Main §26.A.

### **15.5 Observability**

Every `canAccessFeature` call at the LISA boundary emits:

logger.info('tutor\_access\_check', {  
  request\_id,  
  allow: accessResult.allow,  
  reason: accessResult.allow ? null : accessResult.reason  
});

metrics.counter('tutor\_access\_check\_total', {  
  result: accessResult.allow ? 'allow' : 'deny',  
  reason: accessResult.allow ? 'ok' : accessResult.reason  
});

Per 01A §14 redaction: student\_id is hashed in log output. Denial reasons are enumerated (low-cardinality label safe per 01A §15).

## **§16 Zero Guardian Access (INV-03-05)**

Guardians have no LISA access of any kind. The context layer enforces this architecturally:

### **16.1 Architectural enforcement**

* `tutor_conversations` RLS policy: `student_id = auth.uid()`  
* `tutor_messages` RLS policy: `student_id = auth.uid()`  
* `tutor_memory_summaries` RLS policy: `student_id = auth.uid()`  
* `tutor_instruction_assignments` RLS policy: `student_id = auth.uid()`  
* `tutor_question_links` RLS policy: `student_id = auth.uid()`  
* `tutor_instruction_exposures` RLS policy: `student_id = auth.uid()`

No policy exists for guardian access to these tables. A guardian's `auth.uid()` will never match a student's `student_id` on these tables, so queries return zero rows.

### **16.2 No derived views for guardians**

There are no views, materialized views, or functions that aggregate LISA data for guardian consumption. A guardian querying `guardian_dashboard_view` sees mastery, KPI, calendar — all derived from Doc 02B and Doc 02C data, never from tutor tables.

### **16.3 No LISA cost/quota visibility**

Guardians don't see:

* LISA usage counts  
* LISA cost attribution  
* Quota state  
* Crisis flag state  
* Any LISA-derived indicator

This is architecturally impossible because tutor tables are not readable by guardians. The guardian dashboard has no element that could expose LISA state, even aggregated.

### **16.4 Payment without access**

A guardian who pays for a student's Paid tier does not gain LISA access. The guardian funds the entitlement; the student uses it. This is per V8 §36 guardian trust model — guardian linking is trust-establishing only; it does not create entitlement inheritance.

---

# **Part VIII — Database Runtime Contract**

## **§17 Schema Overview**

The six LISA runtime tables:

1. `tutor_conversations` — conversation envelopes with scope metadata  
2. `tutor_messages` — line-by-line conversation history  
3. `tutor_memory_summaries` — durable compact summaries (with V1 structured fields in teaching\_profile)  
4. `tutor_instruction_assignments` — policy decision log  
5. `tutor_question_links` — question relationship log  
6. `tutor_instruction_exposures` — rendered surface log

Plus two config tables:

* `tutor_context_runtime_config` — runtime configuration  
* `tutor_injection_signatures` — known attack patterns

Plus one observability table:

* `tutor_injection_log` — injection detection events

### **17.1 Naming discipline**

All table names use `tutor_` prefix to distinguish LISA runtime data from other product data. Column names follow Doc 02C V4 naming conventions:

* `student_id` everywhere (never `user_id`)  
* `created_at`, `updated_at` as `timestamptz`  
* UUIDs for primary keys and foreign keys  
* `jsonb` for structured JSON content fields  
* `_at` suffix for timestamps, `_count` suffix for counters, `_id` for references

### **17.2 Foreign key discipline**

* `student_id` references `profiles(id)` on ALL tutor tables  
* `conversation_id` references `tutor_conversations(id)` with ON DELETE CASCADE  
* `related_message_id` references `tutor_messages(id)` with ON DELETE SET NULL  
* `source_question_row_id` references `questions(id)` with ON DELETE SET NULL (questions may be retired without cascading tutor cleanup)

### **17.3 Retention and soft-delete**

Per Doc 03 Main §14.2 retention matrix:

* Tutor runtime tables (conversations, messages, memory\_summaries, question\_links) retained during active subscription \+ 7 days post-entitlement-loss  
* `tutor_instruction_assignments` retained 90 days then archived  
* `tutor_instruction_exposures` retained 90 days then archived  
* `tutor_injection_log` retained 180 days then archived

Soft-delete is implemented via `deleted_at` column on `tutor_conversations` (cascade semantic on messages/links). Hard delete via scheduled cron at 7-day window expiry.

### **17.4 Dedicated service role narrowing**

V1 schemas in §18 show RLS policies using a generic `service_role` for broad operator access. **Production deployment must narrow this to dedicated service roles** to minimize blast radius if any single credential is compromised. Granting one role all operations on all tables creates a single point of compromise that a narrowed role model avoids.

**Dedicated roles (V1 launch requirement):**

\-- Runtime writer: called by Doc 03B API during tutor turn flow  
\-- Writes: tutor\_conversations, tutor\_messages, tutor\_instruction\_assignments,  
\--         tutor\_question\_links, tutor\_instruction\_exposures  
\-- Does NOT write: tutor\_memory\_summaries (memory layer), tutor\_injection\_log  
CREATE ROLE tutor\_runtime\_writer;

\-- Memory writer: called by memory refresh service (§9)  
\-- Writes: tutor\_memory\_summaries only  
\-- Does NOT write: any other tutor table  
CREATE ROLE tutor\_memory\_writer;

\-- Archival writer: called by scheduled cleanup/archival jobs (§19)  
\-- Writes: deletes from tutor\_conversations cascading to children;  
\--         archives from tutor\_instruction\_assignments, tutor\_instruction\_exposures,  
\--         tutor\_injection\_log older than retention window  
\-- Does NOT write: new rows to any table  
CREATE ROLE tutor\_archival\_writer;

\-- Injection logger: called by injection detection path  
\-- Writes: tutor\_injection\_log only  
\-- Does NOT write: any other tutor table  
CREATE ROLE tutor\_injection\_writer;

\-- Memory reader (read-only): called by context resolution  
\-- Reads: all tutor tables scoped to student\_id  
\-- Writes: nothing  
CREATE ROLE tutor\_context\_reader;

Per-table RLS policies reference these specific roles, not `service_role` broadly. For example, `tutor_conversations`:

\-- Runtime writer can insert and update conversations  
CREATE POLICY tutor\_conversations\_runtime\_write ON tutor\_conversations  
  FOR INSERT TO tutor\_runtime\_writer WITH CHECK (true);  
CREATE POLICY tutor\_conversations\_runtime\_update ON tutor\_conversations  
  FOR UPDATE TO tutor\_runtime\_writer USING (true);

\-- Archival can soft-delete (set deleted\_at)  
CREATE POLICY tutor\_conversations\_archival\_softdelete ON tutor\_conversations  
  FOR UPDATE TO tutor\_archival\_writer USING (true)  
  WITH CHECK (deleted\_at IS NOT NULL);

\-- Archival can hard-delete only after deleted\_at \+ 7 days  
CREATE POLICY tutor\_conversations\_archival\_harddelete ON tutor\_conversations  
  FOR DELETE TO tutor\_archival\_writer  
  USING (deleted\_at IS NOT NULL AND deleted\_at \< now() \- interval '7 days');

**§18 RLS policy simplification note:** The schemas in §18 show policies with `service_role` for readability. These are illustrative. Production migration must substitute the dedicated roles above. The dedicated-role mapping for each table:

| Table | Insert/Update | Delete |
| ----- | ----- | ----- |
| tutor\_conversations | tutor\_runtime\_writer | tutor\_archival\_writer |
| tutor\_messages | tutor\_runtime\_writer | (no delete; cascade only) |
| tutor\_memory\_summaries | tutor\_memory\_writer | tutor\_archival\_writer |
| tutor\_instruction\_assignments | tutor\_runtime\_writer | tutor\_archival\_writer |
| tutor\_question\_links | tutor\_runtime\_writer | (no delete; cascade only) |
| tutor\_instruction\_exposures | tutor\_runtime\_writer | tutor\_archival\_writer |
| tutor\_injection\_log | tutor\_injection\_writer | tutor\_archival\_writer |
| tutor\_context\_runtime\_config | (manual admin only) | (manual admin only) |
| tutor\_injection\_signatures | (manual admin only) | (manual admin only) |

**Credential management:** Each role is provisioned as a separate Supabase service key, stored in a secrets manager, rotated on a schedule (target: 90 days), and scoped to the service that requires it. Compromise of one credential is contained to that role's capabilities.

**V1 launch blocker:** Before production launch, the dedicated roles must be created, policies must be migrated from broad `service_role` to the narrowed roles, and each service must be configured with its dedicated key. This is a launch-blocking migration item.

## **§18 Schema Definitions**

### **18.1 tutor\_conversations**

CREATE TABLE tutor\_conversations (  
  id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  student\_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,

  \-- Entry metadata (immutable after creation)  
  entry\_mode TEXT NOT NULL CHECK (entry\_mode IN ('scoped\_question', 'scoped\_session', 'general')),  
  source\_surface TEXT NOT NULL CHECK (source\_surface IN ('practice', 'review', 'test\_review', 'dashboard')),  
  source\_session\_id UUID,  
  source\_session\_item\_id UUID,  
  source\_question\_row\_id UUID REFERENCES questions(id) ON DELETE SET NULL,  
  source\_question\_canonical\_id TEXT,

  \-- Default/initialized policy state  
  policy\_family TEXT NOT NULL DEFAULT 'instructional\_tutor',  
  policy\_variant TEXT NOT NULL DEFAULT 'scaffolded'  
    CHECK (policy\_variant IN ('concise', 'scaffolded', 'socratic', 'strategy\_first')),  
  policy\_version TEXT NOT NULL DEFAULT '1.0',  
  prompt\_version TEXT,  
  assignment\_mode TEXT NOT NULL DEFAULT 'deterministic'  
    CHECK (assignment\_mode IN ('deterministic', 'explore', 'manual\_override')),  
  assignment\_key TEXT,  
  initialization\_snapshot JSONB,

  \-- Status  
  status TEXT NOT NULL DEFAULT 'active'  
    CHECK (status IN ('active', 'closed', 'abandoned')),  
  crisis\_flagged BOOLEAN NOT NULL DEFAULT FALSE,

  \-- Soft-delete and retention  
  deleted\_at TIMESTAMPTZ,  
  entitlement\_lost\_at TIMESTAMPTZ,

  \-- Timestamps  
  created\_at TIMESTAMPTZ NOT NULL DEFAULT now(),  
  updated\_at TIMESTAMPTZ NOT NULL DEFAULT now(),  
  closed\_at TIMESTAMPTZ  
);

\-- Conversation reuse envelope lookup (NOT unique — multiple active conversations  
\-- per envelope are allowed; API layer picks most-recently-updated matching one  
\-- per Doc 03B reuse rules, consistent with original runtime contract semantic  
\-- of "reuse preferred" rather than "uniqueness enforced")  
CREATE INDEX idx\_tutor\_conversations\_reuse\_envelope  
  ON tutor\_conversations (student\_id, source\_surface, entry\_mode,  
                          source\_session\_id, source\_question\_row\_id, status, updated\_at DESC)  
  WHERE status \= 'active';

CREATE INDEX idx\_tutor\_conversations\_student\_status  
  ON tutor\_conversations (student\_id, status, updated\_at DESC);

CREATE INDEX idx\_tutor\_conversations\_crisis  
  ON tutor\_conversations (crisis\_flagged, created\_at DESC)  
  WHERE crisis\_flagged \= TRUE;

CREATE INDEX idx\_tutor\_conversations\_deletion\_window  
  ON tutor\_conversations (deleted\_at)  
  WHERE deleted\_at IS NOT NULL;

\-- RLS  
ALTER TABLE tutor\_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY tutor\_conversations\_select\_own ON tutor\_conversations  
  FOR SELECT USING (student\_id \= auth.uid());

CREATE POLICY tutor\_conversations\_insert\_own ON tutor\_conversations  
  FOR INSERT WITH CHECK (student\_id \= auth.uid());

CREATE POLICY tutor\_conversations\_update\_own ON tutor\_conversations  
  FOR UPDATE USING (student\_id \= auth.uid());

\-- Service role full access for orchestrator writes  
CREATE POLICY tutor\_conversations\_service\_role ON tutor\_conversations  
  FOR ALL TO service\_role USING (true);

\-- Trigger: updated\_at  
CREATE TRIGGER tutor\_conversations\_updated\_at  
  BEFORE UPDATE ON tutor\_conversations  
  FOR EACH ROW EXECUTE FUNCTION update\_updated\_at\_column();

### **18.2 tutor\_messages**

CREATE TABLE tutor\_messages (  
  id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  conversation\_id UUID NOT NULL REFERENCES tutor\_conversations(id) ON DELETE CASCADE,  
  student\_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,

  \-- Message content  
  role TEXT NOT NULL CHECK (role IN ('student', 'tutor', 'system')),  
  content\_kind TEXT NOT NULL DEFAULT 'message'  
    CHECK (content\_kind IN ('message', 'suggestion', 'consent\_prompt', 'system\_note')),  
  message TEXT NOT NULL,  
  content\_json JSONB,  
  explanation\_level TEXT,

  \-- Optional turn-level scope linkage (may differ from conversation-level if student navigates)  
  source\_session\_id UUID,  
  source\_session\_item\_id UUID,  
  source\_question\_row\_id UUID REFERENCES questions(id) ON DELETE SET NULL,  
  source\_question\_canonical\_id TEXT,

  \-- Client idempotency  
  client\_turn\_id UUID,

  \-- Injection defense metadata  
  injection\_flag BOOLEAN NOT NULL DEFAULT FALSE,  
  injection\_signature\_matched TEXT,

  \-- Timestamps  
  created\_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT tutor\_messages\_client\_turn\_unique  
    UNIQUE (conversation\_id, client\_turn\_id)  
    \-- idempotency enforcement per Doc 03B §8.4  
);

CREATE INDEX idx\_tutor\_messages\_conversation  
  ON tutor\_messages (conversation\_id, created\_at ASC);

CREATE INDEX idx\_tutor\_messages\_student\_recent  
  ON tutor\_messages (student\_id, created\_at DESC);

CREATE INDEX idx\_tutor\_messages\_injection  
  ON tutor\_messages (injection\_flag, created\_at DESC)  
  WHERE injection\_flag \= TRUE;

\-- RLS  
ALTER TABLE tutor\_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY tutor\_messages\_select\_own ON tutor\_messages  
  FOR SELECT USING (student\_id \= auth.uid());

CREATE POLICY tutor\_messages\_insert\_own ON tutor\_messages  
  FOR INSERT WITH CHECK (student\_id \= auth.uid());

\-- No UPDATE/DELETE for student (append-only from student perspective)  
CREATE POLICY tutor\_messages\_service\_role ON tutor\_messages  
  FOR ALL TO service\_role USING (true);

### **18.3 tutor\_memory\_summaries**

CREATE TABLE tutor\_memory\_summaries (  
  id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  student\_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,

  \-- Summary type and versioning  
  summary\_type TEXT NOT NULL CHECK (summary\_type IN (  
    'teaching\_profile',  
    'chat\_compaction',  
    'recent\_learning\_pattern',  
    'study\_context'  
  )),  
  summary\_version TEXT NOT NULL DEFAULT '1.0',

  \-- Content (schema-validated per §10 based on summary\_type)  
  content\_json JSONB NOT NULL,

  \-- Source window  
  source\_window\_start TIMESTAMPTZ,  
  source\_window\_end TIMESTAMPTZ,

  \-- Freshness tracking  
  last\_refreshed\_at TIMESTAMPTZ NOT NULL DEFAULT now(),  
  refresh\_trigger TEXT,

  \-- Timestamps  
  created\_at TIMESTAMPTZ NOT NULL DEFAULT now(),  
  updated\_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  \-- One current summary per student per type; history via soft-versioning in content\_json  
  CONSTRAINT tutor\_memory\_summaries\_current\_unique  
    UNIQUE (student\_id, summary\_type)  
);

\-- Schema enforcement per §10.5  
CREATE OR REPLACE FUNCTION validate\_memory\_summary\_schema()  
RETURNS TRIGGER AS $$  
BEGIN  
  \-- Validate content\_json against the schema matching summary\_type  
  \-- Implementation in Appendix B  
  IF NEW.summary\_type \= 'teaching\_profile' THEN  
    IF NOT (NEW.content\_json ? 'summary\_version'  
      AND NEW.content\_json ? 'learning\_style\_signals'  
      AND NEW.content\_json ? 'last\_struggled\_skill'  
      AND NEW.content\_json ? 'last\_mastered\_skill'  
      AND NEW.content\_json ? 'engagement\_summary') THEN  
      RAISE EXCEPTION 'Invalid teaching\_profile schema';  
    END IF;  
  ELSIF NEW.summary\_type \= 'chat\_compaction' THEN  
    IF NOT (NEW.content\_json ? 'summary\_version'  
      AND NEW.content\_json ? 'conversation\_id'  
      AND NEW.content\_json ? 'turns\_compacted') THEN  
      RAISE EXCEPTION 'Invalid chat\_compaction schema';  
    END IF;  
  END IF;  
  \-- Similar for other types; full implementation in Appendix B

  RETURN NEW;  
END;  
$$ LANGUAGE plpgsql;

CREATE TRIGGER tutor\_memory\_summaries\_validate\_schema  
  BEFORE INSERT OR UPDATE ON tutor\_memory\_summaries  
  FOR EACH ROW EXECUTE FUNCTION validate\_memory\_summary\_schema();

CREATE INDEX idx\_tutor\_memory\_summaries\_student\_type  
  ON tutor\_memory\_summaries (student\_id, summary\_type);

CREATE INDEX idx\_tutor\_memory\_summaries\_staleness  
  ON tutor\_memory\_summaries (last\_refreshed\_at);

\-- RLS  
ALTER TABLE tutor\_memory\_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY tutor\_memory\_summaries\_select\_own ON tutor\_memory\_summaries  
  FOR SELECT USING (student\_id \= auth.uid());

\-- No student INSERT/UPDATE/DELETE — memory is written by trusted code only (§7.6 Layer A)  
CREATE POLICY tutor\_memory\_summaries\_service\_role ON tutor\_memory\_summaries  
  FOR ALL TO service\_role USING (true);

### **18.4 tutor\_instruction\_assignments**

CREATE TABLE tutor\_instruction\_assignments (  
  id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  conversation\_id UUID NOT NULL REFERENCES tutor\_conversations(id) ON DELETE CASCADE,  
  student\_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,  
  related\_message\_id UUID REFERENCES tutor\_messages(id) ON DELETE SET NULL,

  \-- Scope linkage at assignment time  
  source\_session\_id UUID,  
  source\_session\_item\_id UUID,  
  source\_question\_row\_id UUID,  
  source\_question\_canonical\_id TEXT,

  \-- Policy decision  
  policy\_family TEXT NOT NULL DEFAULT 'instructional\_tutor',  
  policy\_variant TEXT NOT NULL  
    CHECK (policy\_variant IN ('concise', 'scaffolded', 'socratic', 'strategy\_first')),  
  policy\_version TEXT NOT NULL,  
  prompt\_version TEXT,  
  assignment\_mode TEXT NOT NULL  
    CHECK (assignment\_mode IN ('deterministic', 'explore', 'manual\_override')),  
  assignment\_key TEXT,

  \-- Emotional register (per Doc 03 Main §4.11)  
  emotional\_register TEXT NOT NULL DEFAULT 'default'  
    CHECK (emotional\_register IN ('default', 'elite', 'recovery', 'sprint', 'calm')),

  \-- Decision audit  
  reason\_snapshot JSONB NOT NULL,

  \-- Timestamps  
  created\_at TIMESTAMPTZ NOT NULL DEFAULT now()  
);

CREATE INDEX idx\_tutor\_instruction\_assignments\_conversation  
  ON tutor\_instruction\_assignments (conversation\_id, created\_at ASC);

CREATE INDEX idx\_tutor\_instruction\_assignments\_student\_recent  
  ON tutor\_instruction\_assignments (student\_id, created\_at DESC);

CREATE INDEX idx\_tutor\_instruction\_assignments\_register  
  ON tutor\_instruction\_assignments (emotional\_register, created\_at DESC)  
  WHERE emotional\_register \!= 'default';

\-- Enforce reason\_snapshot size bound  
ALTER TABLE tutor\_instruction\_assignments  
  ADD CONSTRAINT reason\_snapshot\_size\_bound  
  CHECK (pg\_column\_size(reason\_snapshot) \< 2048);

\-- RLS  
ALTER TABLE tutor\_instruction\_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY tutor\_instruction\_assignments\_select\_own ON tutor\_instruction\_assignments  
  FOR SELECT USING (student\_id \= auth.uid());

CREATE POLICY tutor\_instruction\_assignments\_service\_role ON tutor\_instruction\_assignments  
  FOR ALL TO service\_role USING (true);

### **18.5 tutor\_question\_links**

CREATE TABLE tutor\_question\_links (  
  id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  conversation\_id UUID NOT NULL REFERENCES tutor\_conversations(id) ON DELETE CASCADE,  
  student\_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,

  \-- Source question (the one being discussed)  
  source\_question\_row\_id UUID REFERENCES questions(id) ON DELETE SET NULL,  
  source\_question\_canonical\_id TEXT,

  \-- Related question (the one being offered/proposed)  
  related\_question\_row\_id UUID REFERENCES questions(id) ON DELETE SET NULL,  
  related\_question\_canonical\_id TEXT,

  \-- Relationship metadata  
  relationship\_type TEXT NOT NULL CHECK (relationship\_type IN (  
    'current',            \-- same question, retry  
    'similar\_retry',      \-- same skill+difficulty, different question  
    'simpler\_variant',    \-- same skill, easier difficulty  
    'harder\_variant',     \-- same skill, harder difficulty  
    'concept\_extension'   \-- related skill or domain  
  )),  
  difficulty\_delta INTEGER,  \-- \-2, \-1, 0, \+1, \+2  
  reason\_code TEXT NOT NULL,

  \-- Snapshot of decision context  
  link\_snapshot JSONB,

  \-- Timestamps  
  created\_at TIMESTAMPTZ NOT NULL DEFAULT now()  
);

CREATE INDEX idx\_tutor\_question\_links\_conversation  
  ON tutor\_question\_links (conversation\_id, created\_at ASC);

CREATE INDEX idx\_tutor\_question\_links\_student  
  ON tutor\_question\_links (student\_id, created\_at DESC);

CREATE INDEX idx\_tutor\_question\_links\_source  
  ON tutor\_question\_links (source\_question\_canonical\_id);

\-- RLS  
ALTER TABLE tutor\_question\_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY tutor\_question\_links\_select\_own ON tutor\_question\_links  
  FOR SELECT USING (student\_id \= auth.uid());

CREATE POLICY tutor\_question\_links\_service\_role ON tutor\_question\_links  
  FOR ALL TO service\_role USING (true);

### **18.6 tutor\_instruction\_exposures**

CREATE TABLE tutor\_instruction\_exposures (  
  id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  assignment\_id UUID NOT NULL REFERENCES tutor\_instruction\_assignments(id) ON DELETE CASCADE,  
  conversation\_id UUID NOT NULL REFERENCES tutor\_conversations(id) ON DELETE CASCADE,  
  student\_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,

  \-- Exposure details  
  exposure\_type TEXT NOT NULL CHECK (exposure\_type IN (  
    'hint',  
    'explanation',  
    'strategy',  
    'similar\_question\_offer',  
    'broader\_coaching\_offer',  
    'consent\_prompt'  
  )),  
  content\_variant\_key TEXT,  
  content\_version TEXT,

  \-- Rendering metadata  
  rendered\_difficulty INTEGER,  
  hint\_depth INTEGER,  
  tone\_style TEXT,  
  sequence\_ordinal INTEGER NOT NULL,

  \-- Interaction  
  shown\_at TIMESTAMPTZ NOT NULL DEFAULT now(),  
  consumed\_ms INTEGER  
);

CREATE INDEX idx\_tutor\_instruction\_exposures\_assignment  
  ON tutor\_instruction\_exposures (assignment\_id, sequence\_ordinal);

CREATE INDEX idx\_tutor\_instruction\_exposures\_student\_type  
  ON tutor\_instruction\_exposures (student\_id, exposure\_type, shown\_at DESC);

\-- RLS  
ALTER TABLE tutor\_instruction\_exposures ENABLE ROW LEVEL SECURITY;

CREATE POLICY tutor\_instruction\_exposures\_select\_own ON tutor\_instruction\_exposures  
  FOR SELECT USING (student\_id \= auth.uid());

CREATE POLICY tutor\_instruction\_exposures\_service\_role ON tutor\_instruction\_exposures  
  FOR ALL TO service\_role USING (true);

### **18.7 Config and observability tables**

\-- Runtime configuration  
CREATE TABLE tutor\_context\_runtime\_config (  
  id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  config\_key TEXT NOT NULL UNIQUE,  
  config\_value JSONB NOT NULL,  
  description TEXT,  
  updated\_at TIMESTAMPTZ NOT NULL DEFAULT now()  
);

\-- Seed values for V1  
INSERT INTO tutor\_context\_runtime\_config (config\_key, config\_value, description) VALUES  
  ('recent\_message\_window', '12', 'Default number of recent messages loaded in Layer 2'),  
  ('memory\_summary\_staleness\_days', '14', 'Days after which teaching\_profile is considered stale'),  
  ('injection\_length\_bound\_chars', '4000', 'Max student message length before rejection'),  
  ('study\_context\_relevance\_window\_days', '7', 'Days before scheduled\_exam\_date that triggers study context load');

\-- Known injection signatures (service-role read/write only)  
CREATE TABLE tutor\_injection\_signatures (  
  id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  signature\_pattern TEXT NOT NULL,  
  signature\_type TEXT NOT NULL,  
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),  
  action TEXT NOT NULL CHECK (action IN ('flag', 'reject', 'silent\_redirect')),  
  added\_at TIMESTAMPTZ NOT NULL DEFAULT now(),  
  added\_by TEXT  
);

ALTER TABLE tutor\_injection\_signatures ENABLE ROW LEVEL SECURITY;  
CREATE POLICY tutor\_injection\_signatures\_service\_role ON tutor\_injection\_signatures  
  FOR ALL TO service\_role USING (true);

\-- Injection detection log (for safety review queue)  
CREATE TABLE tutor\_injection\_log (  
  id UUID PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  conversation\_id UUID REFERENCES tutor\_conversations(id) ON DELETE SET NULL,  
  student\_id UUID REFERENCES profiles(id) ON DELETE RESTRICT,  
  message\_id UUID REFERENCES tutor\_messages(id) ON DELETE SET NULL,  
  signature\_matched TEXT,  
  detection\_layer TEXT NOT NULL,  \-- 'layer\_3\_sanitization', 'layer\_4\_output', etc.  
  action\_taken TEXT NOT NULL,  
  response\_substituted TEXT,  
  detected\_at TIMESTAMPTZ NOT NULL DEFAULT now()  
);

CREATE INDEX idx\_tutor\_injection\_log\_student\_recent  
  ON tutor\_injection\_log (student\_id, detected\_at DESC);

CREATE INDEX idx\_tutor\_injection\_log\_signature  
  ON tutor\_injection\_log (signature\_matched, detected\_at DESC);

ALTER TABLE tutor\_injection\_log ENABLE ROW LEVEL SECURITY;  
\-- Service role only — students do not see injection log (INV-03-13)  
CREATE POLICY tutor\_injection\_log\_service\_role ON tutor\_injection\_log  
  FOR ALL TO service\_role USING (true);

## **§19 Scheduled Jobs**

Scheduled job architecture per V3 rebase (Q4=b): pg\_cron schedules the trigger; actual work runs in application code via Supabase Edge Functions or HMAC-authenticated callbacks (01A Part VII) for cross-service invocations. Pure SQL cron is acceptable only for intra-DB tasks with no cross-service coordination.

### **19.1 Memory refresh job**

Runs daily at 03:00 UTC. Refreshes `recent_learning_pattern` and `study_context` summaries for students with activity in the last 7 days.

\-- pg\_cron registration — schedules the trigger only  
SELECT cron.schedule(  
  'tutor\_memory\_refresh\_nightly',  
  '0 3 \* \* \*',  
  $$SELECT public.trigger\_memory\_refresh\_job();$$  
);

The `trigger_memory_refresh_job` SQL function is thin: it posts an HMAC-signed request to the internal memory-refresh worker endpoint (service pair `memory-refresh-scheduler → memory-refresh-worker` per 01A §64). The worker performs the extraction per §9.2 (SQL-vs-code boundary rule), then writes via `/api/internal/memory/compact-writeback` with the `memory-refresh-worker → main-api` service pair HMAC signature.

Failure envelope per 01A error classes:

* HMAC verification failure → 401 per 01A §67; worker retries with overlap secret per 01A §65.2  
* Downstream DB write failure → surfaces as 5xx; scheduler records to observability and retries next cycle  
* Bounded retry on transient failures (connection, timeout, 5xx): max 1 retry per call, then surface to observability. Persistent failure handled by next cycle rather than retry loop. Aligned with 01A §28 reconnection pattern philosophy (bounded retries with exponential backoff for listener paths; bounded max-1-retry for job callback paths).

### **19.2 Soft-delete cleanup job**

Runs hourly. Hard-deletes tutor conversations (and cascaded messages, assignments, links, exposures) where `deleted_at + 7 days < now()` per the retention matrix. This is intra-DB; no cross-service call required.

SELECT cron.schedule(  
  'tutor\_soft\_delete\_cleanup',  
  '0 \* \* \* \*',  
  $$SELECT public.cleanup\_expired\_tutor\_conversations();$$  
);

Emits observability event per 01A §11: `logger.info('tutor_soft_delete_cleanup_run', { rows_deleted, duration_ms })`.

### **19.3 Archival job for instruction data**

Runs nightly. Archives `tutor_instruction_assignments` and `tutor_instruction_exposures` older than 90 days to cold storage. Because archival targets external storage (S3 or equivalent), this job uses the HMAC-authenticated callback pattern:

SELECT cron.schedule(  
  'tutor\_instruction\_archival',  
  '0 4 \* \* \*',  
  $$SELECT public.trigger\_instruction\_archival\_job();$$  
);

`trigger_instruction_archival_job` posts to `/api/internal/tutor/archival/run` with the `archival-scheduler → archival-worker` service pair HMAC signature per 01A §62. Worker performs export, writes to cold storage, then calls back to `/api/internal/tutor/archival/complete` (service pair `archival-worker → main-api`) which deletes the archived rows from primary tables.

### **19.4 Entitlement-lost cleanup**

Runs every 4 hours. Identifies conversations where `entitlement_lost_at + 7 days < now()` and triggers soft-delete. Intra-DB; no cross-service call required.

SELECT cron.schedule(  
  'tutor\_entitlement\_lost\_cleanup',  
  '0 \*/4 \* \* \*',  
  $$SELECT public.cleanup\_entitlement\_lost\_conversations();$$  
);

### **19.5 Job-level observability (01A Part II)**

Every scheduled job emits structured logs and metrics per 01A conventions:

// At job start  
logger.info('tutor\_scheduled\_job\_start', {  
  job\_name,  
  request\_id,           // correlation ID for the job run  
  scheduled\_at  
});

// At job completion  
logger.info('tutor\_scheduled\_job\_complete', {  
  job\_name,  
  request\_id,  
  duration\_ms,  
  rows\_processed,  
  failures  
});

// Metrics  
metrics.counter('tutor\_scheduled\_job\_run', { job\_name, result: 'success|failure' });  
metrics.histogram('tutor\_scheduled\_job\_duration\_ms', duration\_ms, { job\_name });

Alert thresholds per 01A §18:

* Memory refresh job failure → Page  
* Soft-delete cleanup failure for 3+ consecutive hours → Page  
* Archival job failure → Warn (degraded but non-blocking; catches up on next run)  
* Entitlement-lost cleanup failure → Warn

## **§19A Context Layer Observability and Telemetry**

Observability at the context layer is required for operational health, cost control, and quality monitoring. Per V3 rebase (Q1=b), generic observability conventions — structured logger, correlation IDs, metrics naming, PII redaction, alert routing — are governed by Doc 01A Part II. This section specifies only LISA-specific observability that 01A Part II cannot generically cover: which metrics to emit, context-layer SLO targets, and LISA-specific dashboards.

**Inherited from 01A Part II (not re-specified here):**

* Structured logger interface (01A §11)  
* `request_id` correlation middleware and propagation through async boundaries (01A §12, §17)  
* Log levels, log sinks, retention (01A §13, §19)  
* PII redaction transport — includes raw tutor prompts, raw tutor responses, student answers per blocked-fields list (01A §14)  
* Metrics interface, naming convention `<subsystem>_<object>_<verb>[_<unit>]`, percentile conventions P50/P95/P99 (01A §15, §16)  
* Alert routing (Page / Warn / Info / Debug) per 01A §18

**LISA-specific observability (specified below):**

### **19A.1 Context build metrics**

**Tracked per context resolution:**

* `context_build_duration_ms` — time from API boundary to context envelope complete  
* `context_payload_size_bytes` — final envelope size  
* `context_payload_size_tokens` — estimated token count (for budget tracking)  
* `layer_count_loaded` — 1-5 (which layers actually populated)  
* `trim_applied` — boolean, whether §20.7 trimming was invoked  
* `trim_reason` — if trim applied, which layer was cut

**Aggregation dashboards:**

* P50/P95/P99 context build duration — target P50 \<150ms, P95 \<400ms, P99 \<800ms  
* Context payload size distribution — alert if P95 exceeds 80% of orchestrator budget  
* Trim frequency — alert if \>5% of turns trigger trimming (indicates budget mis-sizing)  
* Layer population heatmap — which layers load for which entry modes (catches bugs where a layer fails silently)

### **19A.2 Memory layer metrics**

**Tracked per context resolution:**

* `memory_summary_hit_count` — count of summaries loaded  
* `memory_summary_hit_by_type` — counts per summary\_type  
* `memory_summary_staleness_distribution` — age of loaded summaries  
* `memory_summary_freshness_flag` — did the context use a stale summary

**Aggregation:**

* Summary hit rate per student segment — measures "Knows Me" coverage  
* Staleness distribution — alert if P95 staleness \>30 days (refresh job falling behind)  
* Dropped-summary count (due to poisoning defense §7.6 Layer C) — daily review

**SLO target:**

* **Memory freshness SLA:** P95 of teaching\_profile summaries for active students must be \<21 days old. Breach triggers refresh job capacity review.

### **19A.3 Injection and abuse detection metrics**

**Tracked per turn:**

* `injection_flag_set` — boolean, was the turn flagged as injection  
* `injection_signature_matched` — which pattern if any  
* `abuse_pattern_detected` — bot / retry\_storm / account\_sharing / etc.

**Aggregation:**

* Injection detection rate per student (should be very low for legitimate users)  
* Injection detection rate globally (baseline establishment — detect spikes indicating new attack patterns)  
* False positive audit rate — weekly review of flagged turns by safety review queue to estimate false positive rate  
* Abuse pattern distribution — which patterns fire most

### **19A.4 Policy assignment metrics**

**Tracked per turn:**

* `policy_variant_assigned` — which of the four variants  
* `emotional_register_assigned` — which register  
* `mode_transition_this_turn` — boolean  
* `similar_question_offered_this_turn` — boolean

**Aggregation:**

* Variant distribution by student segment, surface, mastery band  
* Register distribution with shadow-mode flag (per §14.8) for Recovery/Elite during phased enablement  
* Mode transition rate (too high suggests policy instability; too low suggests policy rigidity)  
* Similar question offer acceptance rate — measures value of the feature

### **19A.5 Cost metrics**

Cross-reference Doc 03 Main §24. Context layer contributes to cost primarily through:

* Token count in context payload (input tokens to orchestrator)  
* Memory retrieval DB queries (read cost)  
* Classifier inference (register classification, injection scanning)

**Tracked:**

* `context_input_tokens` per turn — feeds Doc 03 Main §24 cost calculation  
* `context_db_query_count` per turn — DB read cost contribution  
* `classifier_inference_count` per turn — separate model inferences (register, crisis, injection)

**Aggregation:**

* Per-student-per-day token cost attribution  
* Per-feature cost: what does Memory contribute? What does Register classification contribute?  
* Cost anomaly detection per Doc 03 Main §26.A Failure Mode Matrix

### **19A.6 Quality signals**

**Tracked:**

* `student_thumbs_up` / `student_thumbs_down` on tutor responses (if UI collects)  
* `conversation_completion_rate` — did the conversation reach natural closure vs abandon mid-turn  
* `session_retry_correctness_post_tutor` — after a tutor turn, did the student's next attempt improve

These feed the §14.8 eval harness for register validation and the broader A/B experimentation framework (V2 target).

### **19A.7 Context-specific SLO targets**

These extend Doc 01A §74A per-primitive SLOs with LISA-specific targets. 01A §74A covers platform primitives (config, caching, idempotency, etc.); this table covers context-resolution-level SLOs that compose multiple primitives.

| Metric | Target | Notes |
| ----- | ----- | ----- |
| Context build P50 | \<150ms | From API boundary to envelope complete; composes mastery cache reads (01A §74A \<50µs hit / \<10ms miss) \+ memory summary load \+ entry scope resolution |
| Context build P95 | \<400ms | Includes memory loads and classifier calls |
| Context build P99 | \<800ms | Hard ceiling |
| Mastery cache hit rate | P95 \>90% | §8.6 two-tier caching per 01A Part III |
| Memory freshness SLA | P95 \<21 days | Teaching profile staleness for active students |
| Memory refresh job success rate | \>99% | Daily refresh success |
| Soft-delete cleanup latency | \<24 hours from window expiry | 7-day deleted rows cleaned within 24h of eligibility |
| Injection false positive rate | \<10% of flags | Weekly review target |
| Trim frequency | \<5% of turns | Above \= budget mis-sized |
| RLS policy evaluation overhead | \<5ms per query | Policies should not dominate query time |
| `AbuseScoreService.getScore` call in context path | P95 \<200µs | Cached hit per 01A §74A; cold-path fallback allowed up to 30ms P95 |
| `EntitlementService.canAccessFeature` call per turn | P95 \<50ms | Includes abuse-tier check per V8 §27.3 \+ 01A §50 |

SLO breaches in production trigger alerts per 01A §18 routing: sustained P95 breach \>10 min \= Warn; sustained P95 breach \>1hr \= Page.

### **19A.8 Dashboards and alerting**

**V1 launch dashboards:**

* Context health: build times, sizes, trim frequency, layer population  
* Memory health: refresh success, staleness distribution, hit rates  
* Abuse health: injection rate, abuse pattern rate, flag reviews backlog  
* Cost health: per-student-per-day, per-feature, anomaly alerts  
* Quality health: register distribution (including shadow), thumbs feedback

**V1 alerts (paged):**

* Context build P95 \>600ms sustained 10 min  
* Memory refresh job failure  
* Injection false positive rate \>20% weekly  
* Trim frequency \>10% of turns  
* Cost anomaly \>2x baseline sustained 30 min

**V2 additions:**

* ML-driven anomaly detection across metrics  
* Per-student usage patterns visualization  
* Feature-level A/B reporting

### **19A.9 Instrumentation ownership**

Observability is a joint Engineering \+ Product ownership. Engineering owns the instrumentation (emitting metrics from context resolution code). Product owns the dashboards (what to display, what to alert on, how to interpret). Metrics not emitted are not useful — every code path that matters must emit the listed metrics before V1 launch.

---

# **Part IX — Error and Edge Cases**

## **§20 Context Resolution Failures**

### **20.1 Stale or missing scoped question**

If the referenced question/session item is stale, missing, or deleted: per §5.3, follow the fallback chain. Log the fallback in `reason_snapshot.fallback_used = true`. Student experience: LISA transitions to a slightly broader conversation without announcement ("Let's talk about what you're working on in general" rather than "That question is missing").

### **20.2 Entitlement lost mid-conversation**

Per §15.2. Next turn blocked with access-denied response. Conversation history preserved for 7 days.

### **20.3 Memory summary corruption**

If a memory summary fails schema validation on read (e.g., the trigger allowed a bad summary through due to a bug): the summary is dropped from the context payload, a log event is written, and LISA proceeds without that summary layer. Eventually consistent: the next memory refresh job run will rewrite the summary with valid content.

### **20.4 Concurrent conversation scoping**

Students may have multiple active conversations simultaneously. Per §2.4, each conversation has immutable scope. The client must pass the intended `conversation_id` for continuing a conversation. If the client opens a new conversation with the same (student, source\_surface, entry\_mode, source\_session\_id) envelope as an active one, Doc 03B API reuses the existing conversation rather than creating a duplicate.

### **20.5 Question retirement mid-conversation**

If a canonical question is retired (removed from `questions` or marked inactive) mid-conversation, the conversation continues with whatever question content was loaded in prior turns. New turns referencing the retired question fall back to the scoped\_session mode. The retirement is a rare operational event, not a normal flow.

### **20.6 Policy change mid-conversation**

If a policy\_variant is deprecated or a new one is added, active conversations continue with their assigned variant until the conversation closes. New conversations use the updated variant set. Policy version bumps are rolling — no forced mid-conversation variant changes.

### **20.7 Context payload size overflow**

If the assembled context envelope exceeds the orchestrator's size budget (default: under 16K tokens for V1), the context layer trims in this priority order:

1. Drop oldest recent\_messages beyond a minimum of 4  
2. Drop `recent_learning_pattern` summary  
3. Drop `study_plan_context` if not a study-plan-related turn  
4. Drop `chat_compaction` summary older than 30 days  
5. Reduce `current_question` to just stem \+ options (drop explanation if post-submit)

If after all trimming the envelope still exceeds budget, fail closed: throw `ContextPayloadOverflowError` (03A-specific, extends `Error`) which Doc 03B API translates to 500 with user-facing "Conversation context is too large; please start a new conversation." Emit metrics counter `tutor_context_overflow_count` per 01A §15 for operational tracking. This is a rare edge case.

## **§21 Recovery and Consistency**

### **21.1 Message persistence ordering**

Per Doc 03 Main §18.2 and Doc 03B §7 (pending): for a successful tutor turn, the write order is:

1. Student message persisted to `tutor_messages`  
2. Policy assignment persisted to `tutor_instruction_assignments`  
3. Orchestrator invoked (model call)  
4. Output scanned (Layer 4\)  
5. Tutor response persisted to `tutor_messages`  
6. `tutor_question_links` written if any  
7. `tutor_instruction_exposures` written if any  
8. Success returned to client

If any blocking step fails, the turn is not returned as successful. Partial writes are cleaned up by transaction rollback where possible, or left for recovery per §21.2.

### **21.2 Orphan cleanup**

Orphan cleanup handles cases where partial state persists due to non-transactional failures:

* `tutor_instruction_assignments` without a tutor response message in `tutor_messages` → cleaned up daily  
* `tutor_question_links` where source or related question is deleted → set to NULL  
* `tutor_instruction_exposures` referencing deleted assignments → cascade-deleted

### **21.3 Idempotent retry**

Client retries must be idempotent per INV-03-18 and Doc 03B. `client_turn_id` is the idempotency key, consumed by 01A Part IV `IdempotencyService` with `scope = 'tutor_turn'` (01A §36 consumer map). The `tutor_messages_client_turn_unique` constraint prevents duplicate student message rows at the DB level as a secondary safety net.

Per 01A Part IV semantics:

* First request for a given `client_turn_id` → fresh execution, result stored  
* Duplicate request with same content hash → cached result returned (01A §32)  
* Duplicate request with different content hash → 409 Conflict per 01A §33 (`IdempotencyConflictError`)  
* Partial-failure recovery via `in_progress / completed / failed` status tracking per 01A §35

Retention per 01A §34: `tutor_turn` scope TTL is 7 days. After 7 days, the idempotency record expires and the same `client_turn_id` may be reused.

`IdempotencyService` is Doc 03B's boundary; 03A does not implement idempotency directly. 03A's concern is that the context envelope shape does not depend on whether this is a fresh request or a replay — context resolution is deterministic given the inputs.

---

# **Part IX.5 — V1 Launch Core vs V2 Targets**

Doc 03A defines substantial surface area. Shipping all of it at V1 launch is not the right sequencing — some features mature naturally post-launch as real data accumulates. This section makes the V1 vs V2 scope break explicit, paralleling Doc 03 Main §25 and §27.

## **§21A V1 Launch Core (Must Ship)**

The following are non-negotiable for V1 launch. Missing any of these blocks launch:

**Context resolution:**

* Five-layer context resolution (§5) with all five layers functional  
* Entry mode classification (scoped\_question / scoped\_session / general)  
* Source surface enforcement (practice / review / test\_review / dashboard)  
* Context payload envelope (§5.4) generated for every turn  
* Study-plan relevance rule (§5.2) — loaded only when conditions fire

**Memory:**

* Short-term memory (`tutor_messages` window load)  
* Durable memory with all four summary types (teaching\_profile, chat\_compaction, recent\_learning\_pattern, study\_context)  
* V1 structured fields: `last_struggled_skill` and `last_mastered_skill` within `teaching_profile`  
* Memory refresh job running nightly  
* Memory freshness SLA monitored  
* Memory poisoning defense (4 layers)

**Mastery read contract:**

* LISA reads all mastery tables per §8.2  
* LISA never writes mastery (INV-03-01)  
* `tutor_question_links` writes for similar-question audit

**Injection defense:**

* All 5 layers from Doc 03 Main §18 operational  
* Boundary markers on student / memory / canonical content  
* Pre-forwarding sanitization (tag escaping, length bounds, signature scan)  
* Silent injection handling (INV-03-13)  
* Injection log writes

**Abuse controls:**

* Retry storm detection with 429 throttling  
* Injection log unified with abuse pattern logging  
* Other abuse patterns (§12A.2-12A.6) — detection and logging only, no active enforcement at V1

**Mode taxonomy:**

* Product modes: all four (Hint, Explanation, Strategy, Review)  
* Policy variants: all four (concise, scaffolded, socratic, strategy\_first)  
* Emotional registers: Default, Sprint, Calm active; Recovery and Elite in shadow mode (per §14.8)  
* Mode transition logging (INV-03-15)

**Entitlement and access:**

* Per-request entitlement check (INV-03-18)  
* No grace period; fail-closed on errors  
* Zero guardian access architecturally enforced (INV-03-05)  
* Dedicated service roles (§17.4) provisioned

**Database:**

* All 6 runtime tables \+ 3 supporting tables created  
* RLS policies with dedicated service roles (§17.4)  
* All scheduled jobs (§19) registered on pg\_cron; HMAC-signed callbacks for cross-service invocations  
* Soft-delete and archival working  
* Table ownership classes aligned with 01A Appendix D / V8 Appendix E single-writer / shared-append-only governance

**01A platform primitives integration (V3-specific):**

* `tutor_context_runtime_config` seeded with V1 values; LISTEN/NOTIFY invalidation trigger deployed  
* Mastery reads consuming 01A Part III two-tier cache (§8.6); LISTEN/NOTIFY on `mastery_invalidate` channel verified  
* `AbuseScoreService.recordIncident` emitted from every abuse detection point in §12 and §12A  
* `EntitlementService.canAccessFeature('tutor_access', ...)` consumed at §15 boundary  
* `IdempotencyService` with `tutor_turn` scope consumed by Doc 03B (verified in 03B acceptance criteria but flagged here as 03A dependency)  
* `RateLimitLedger` with `tutor_turns_daily` bucket active  
* Internal service auth (HMAC) for memory refresh callback and archival callback deployed and rotation tested  
* Context layer logging migrated to 01A Part II structured logger; correlation IDs present on \>99% of LISA logs

**Observability:**

* Context build metrics emitted via 01A metrics interface  
* Memory metrics emitted  
* Injection/abuse metrics emitted (with `AbuseScoreService.recordIncident` dual-write to 01A)  
* Policy assignment metrics emitted  
* V1 launch dashboards configured  
* V1 launch alerts configured and routed

**Governance:**

* Doc 03A V2 locked  
* Reconciliation queries from §41 run; discrepancies resolved  
* Migration plan for production deployment approved

## **§21B V1 Post-Launch Phased Rollout**

The following ship in V1 phases, not at day-zero launch:

**Phase 1 (launch):** Everything in §21A

**Phase 2 (week 4-6 post-launch):**

* Recovery register activation from shadow to 10% canary, expanding to 100% if eval precision ≥90%  
* Initial abuse pattern active enforcement (retry\_storm → auto-pause at thresholds)  
* Memory freshness SLA tuning based on real refresh job performance

**Phase 3 (week 8-10 post-launch):**

* Elite register activation following same canary path  
* Quota farming active response (effective quota reduction for confirmed patterns)  
* Expanded classifier eval — false positive reviews weekly

## **§21C V2 Targets**

The following are deferred to V2 (post-launch roadmap, not launch-blocking):

**Memory extensions:**

* Full structured extraction: `patterns_observed`, `preferred_explanation_style`, `test_day_readiness`  
* summary\_version bump to 2.0 with additive schema  
* Memory opt-out UI for students  
* Per-student memory deletion at opt-out

**Policy and experimentation:**

* `assignment_mode = 'explore'` for A/B testing variants  
* Additional policy\_family values (e.g., metacognitive coaching)  
* Additional policy\_variants as pedagogical research informs  
* Bandit selection over deterministic for variant choice

**Abuse detection active enforcement:**

* CAPTCHA challenges for bot patterns  
* Automated account-sharing challenges  
* ML-based quota farming detection and response  
* Repeated failure exploit classifier

**Observability and experimentation:**

* ML-driven anomaly detection  
* Per-student pattern visualization  
* Feature-level A/B reporting framework  
* Continuous classifier eval automation with auto-rollback

**Response delivery:**

* Streaming responses (currently synchronous per Doc 03 Main §9)  
* Partial context updates for long-running conversations  
* Proactive tutor prompts (LISA initiates on detected friction)

**Advanced memory:**

* Skill-specific memory summaries (not just teaching\_profile)  
* Cross-conversation pattern detection  
* Long-term trajectory summaries (\>90 day windows)

## **§21D Future Targets (Undated)**

Features acknowledged but not on V2 roadmap:

* Non-English language support (pending future Doc 01 revision; then register localization)  
* Multi-exam platform support (GRE, ACT extensions — requires mastery taxonomy expansion)  
* Voice-based interaction  
* Collaborative study features (multiple students in one session)

These are product-direction statements, not engineering commitments. They may change based on post-V2 data.

---

# **Part X — Acceptance Criteria**

## **§22 Acceptance Criteria for Doc 03A V2**

Doc 03A V2 is satisfied when:

**Context resolution:**

* \[ \] Tutor opens in the correct entry mode based on source surface launch  
* \[ \] Scoped launches prioritize the exact question/session in view per §5  
* \[ \] Study-plan context loads only when §5.2 relevance rule triggers

**Memory:**

* \[ \] Line-by-line tutor history is persisted canonically in `tutor_messages`  
* \[ \] Memory summaries conform to V1 schemas in §10 (verified by schema trigger)  
* \[ \] V1 structured fields `last_struggled_skill` and `last_mastered_skill` populate on teaching\_profile refresh  
* \[ \] SQL-vs-code boundary respected: extraction logic in application layer, persistence in SQL (§9.2, §10.5)

**Mastery:**

* \[ \] LISA does not write mastery (verified by absence of mastery-table references in LISA code paths)  
* \[ \] All mastery reads align with Doc 02C V4 semantics (read computed values, never recompute)

**Policy logging:**

* \[ \] Policy decisions are logged per turn or pivot to `tutor_instruction_assignments`  
* \[ \] Emotional register activations are logged with trigger classification  
* \[ \] Similar-question offers are consent-based and logged to `tutor_question_links`

**Registers (V1 launch gating — §14.8):**

* \[ \] Default, Sprint, Calm registers active at launch  
* \[ \] Recovery, Elite registers in shadow mode at launch (classifier runs, logs, does not affect tone)  
* \[ \] Eval harness operational with precision/recall tracking per register  
* \[ \] Phase 2/3 activation plan documented and owned

**Security:**

* \[ \] Canonical question identifiers remain internal-only (never in output)  
* \[ \] Guardians cannot access any tutor data (verified by RLS policies on every tutor table)  
* \[ \] Injection defense Layer 3 (boundary markers, sanitization, length bounds) operates on every turn  
* \[ \] Silent injection handling preserves student experience (no acknowledgment of detection)  
* \[ \] Entitlement is re-checked on every read/write boundary  
* \[ \] Abuse controls (§12A) operational: retry storm throttling active; other patterns logging-only at V1  
* \[ \] Dedicated service roles provisioned (§17.4): tutor\_runtime\_writer, tutor\_memory\_writer, tutor\_archival\_writer, tutor\_injection\_writer, tutor\_context\_reader  
* \[ \] RLS policies migrated from broad `service_role` to dedicated roles per §17.4 mapping table  
* \[ \] Service role credentials stored in secrets manager with 90-day rotation schedule

**Database:**

* \[ \] Runtime names match the DB schema exactly  
* \[ \] Retention/soft-delete windows honor Doc 01 V8 §40 and Doc 03 Main §14.2  
* \[ \] Scheduled jobs (memory refresh, soft-delete cleanup, archival) execute on pg\_cron  
* \[ \] `tutor_conversations` non-unique reuse-lookup index in place (§18.1); multiple active conversations per envelope allowed

**Observability (§19A):**

* \[ \] Context build metrics emitted (duration, size, layer count, trim frequency)  
* \[ \] Memory metrics emitted (hit count, staleness, freshness flag)  
* \[ \] Injection/abuse metrics emitted  
* \[ \] Policy assignment metrics emitted  
* \[ \] V1 launch dashboards configured  
* \[ \] V1 launch alerts configured and routed to on-call  
* \[ \] Context-specific SLO targets established: P50 \<150ms, P95 \<400ms, memory freshness P95 \<21d

**Scope discipline (§21A-D):**

* \[ \] V1 Launch Core items all shipped before launch  
* \[ \] V1 Phase 2/3 plan documented with activation criteria  
* \[ \] V2 targets captured but not blocking launch

**01A platform primitives integration (V3):**

* \[ \] `tutor_context_runtime_config` table created; LISTEN/NOTIFY invalidation verified (config change propagates to all instances within 5s in staging)  
* \[ \] Mastery reads (§8.6) using 01A two-tier cache; P95 cache hit rate \>90% measured  
* \[ \] `AbuseScoreService.recordIncident` emitted for all abuse detection points (§12.8, §12A.1-§12A.6); events visible in `abuse_score_incidents` with correct `incidentType` values  
* \[ \] `EntitlementService.canAccessFeature('tutor_access', ...)` consumed at §15 boundary (no direct SQL entitlement reads in LISA code paths; verified via grep)  
* \[ \] `tutor_turn` scope registered in 01A `idempotency_runtime_config.ttl_by_scope` (consumed by Doc 03B — blocking on 03B acceptance)  
* \[ \] `tutor_turns_daily` rate limit bucket active via `RateLimitLedger` with abuse-score multiplier integration  
* \[ \] Internal service auth secrets provisioned for `memory-refresh-scheduler → memory-refresh-worker`, `memory-refresh-worker → main-api`, `archival-scheduler → archival-worker`, `archival-worker → main-api` service pairs; first rotation tested  
* \[ \] All LISA code paths use 01A Part II structured logger (zero `console.log` in LISA production code verified by grep)  
* \[ \] Correlation IDs present on \>99% of LISA logs in staging sample window  
* \[ \] PII redaction verified for `tutor_messages.message`, `tutor_memory_summaries.content_json`, tutor prompts, tutor responses — none appear in logs under any level

---

# **Part XI — Governance**

## **§23 Review Triggers**

Doc 03A must be reviewed when any of the following occur:

* Doc 02C mastery schema changes that affect read contracts in §8  
* Doc 02B runtime event taxonomy changes affecting event sources  
* Doc 01 V8 entitlement model or `canAccessFeature` signature changes affecting §15 call shape  
* Doc 01 V8 account deletion or soft-delete retention policy changes  
* Doc 01A platform primitive interface changes (config, logger, cache, idempotency, rate limit, abuse score, internal service auth) — specifically changes to 01A §53 scoring formula, 01A §52 incident taxonomy, 01A Part VII signing convention, or 01A §0.6 error class additions  
* Doc 03 Main persona or mode taxonomy changes  
* Tutor-related database migration  
* Change to anti-leak rules affecting context scrubbing  
* Change to injection defense architecture  
* New summary\_type added or V2 extraction enabled

## **§24 Lock Semantics**

"Locked" means:

* The runtime contract is authoritative for implementation  
* Changes require explicit update of this document and any related DB/runtime contracts  
* Silent drift in code or schema is not allowed

Post-lock, additive clarification is allowed. Behavior-changing changes require explicit review, version update, and change record.

## **§25 Migration Rule**

If the live DB or repo contracts differ from this document, the mismatch must be reconciled explicitly. This document must not silently drift from the database runtime contract.

If a discrepancy is discovered (schema has a column Doc 03A doesn't mention, or vice versa):

1. Log the discrepancy  
2. Determine canonical truth (spec or production)  
3. Update whichever is wrong  
4. Document the reconciliation in change records

---

# **Part XII — Change Records**

Lyceon change record convention: prefix CR-03A-\<number\>. New records append; existing records not modified.

**CR-03A-01** — Doc 03A established as canonical V1. Rebases prior "TUTOR\_CONTEXT\_AND\_MEMORY\_RUNTIME\_CONTRACT" internal draft. Supersedes PDF-06 §5 "RAG Architecture" in full.

**CR-03A-02** — Entry modes locked: scoped\_question, scoped\_session, general. Source surfaces locked: practice, review, test\_review, dashboard. Both immutable after conversation creation.

**CR-03A-03** — Context resolution order locked in 5 layers: entry scope → conversation history → durable memory → student learning context → expansion retrieval. Study-plan context loaded only per §5.2 relevance rule.

**CR-03A-04** — Memory model locked as hybrid: compact summaries (teaching\_profile, chat\_compaction, recent\_learning\_pattern, study\_context) plus V1 structured fields (last\_struggled\_skill, last\_mastered\_skill) enabling "Knows Me" moments per Doc 03 Main §4.10. Full structured extraction deferred to V2.

**CR-03A-05** — Mastery read contract locked: LISA reads from Doc 02C V4 tables (student\_skill\_mastery, student\_domain\_mastery, student\_section\_projections, student\_kpi\_rollups\_current, student\_mastery\_weekly\_snapshots, mastery\_events). LISA never writes. Never invokes apply\_learning\_event\_to\_mastery or any mastery-writing RPC. Retries flow through Doc 02B V4 runtime engines with canonical source\_family values.

**CR-03A-06** — Injection defense Layer 3 (input content isolation) implemented via boundary markers on all student-generated content, memory content, and canonical question content. Pre-forwarding sanitization includes tag pass-through escaping, length bounds, nested instruction detection, known attack signature scan. Silent handling per INV-03-13.

**CR-03A-07** — Mode taxonomy orthogonality confirmed at runtime: product modes (Hint/Explanation/Strategy/Review) and policy\_variants (concise/scaffolded/socratic/strategy\_first) combine independently. Emotional registers (default/elite/recovery/sprint/calm) layer on top per Doc 03 Main §4.11. All three axes logged to tutor\_instruction\_assignments.

**CR-03A-08** — Per-request entitlement check locked per INV-03-18. No grace period. Fail-closed on check errors. Mid-conversation entitlement loss blocks next turn; preserves history for 7 days.

**CR-03A-09** — Six canonical tutor runtime tables locked with full CREATE TABLE schemas: tutor\_conversations, tutor\_messages, tutor\_memory\_summaries, tutor\_instruction\_assignments, tutor\_question\_links, tutor\_instruction\_exposures. Plus three supporting tables: tutor\_context\_runtime\_config, tutor\_injection\_signatures, tutor\_injection\_log. All tables have RLS policies enforcing student\_id \= auth.uid() with service\_role bypass for orchestrator writes.

**CR-03A-10** — Zero guardian access (INV-03-05) enforced architecturally via RLS policies. No policy exists granting guardian access to any tutor table. No aggregated view for guardians. No LISA cost/quota visibility on guardian dashboard.

**CR-03A-11** — Memory poisoning defense locked: 4-layer defense (trusted writer only, schema constraints, content scanning on read, silent failure). Memory tables have no student-writable API endpoint.

**CR-03A-12** — Scheduled jobs registered on pg\_cron: memory refresh nightly 03:00 UTC, soft-delete cleanup hourly, instruction archival nightly 04:00 UTC, entitlement-lost cleanup every 4 hours.

**CR-03A-13** — Memory freshness thresholds locked: teaching\_profile 14 days, chat\_compaction at conversation close or window exceeded, recent\_learning\_pattern 7 days, study\_context 3 days.

**CR-03A-14** — Acceptance criteria V1 locked in §22. All items must be verifiable before Doc 03A is considered implemented.

**CR-03A-15 (V2)** — SQL-vs-code boundary clarified per CTO pushback. §9.2 and §10.5 updated: SQL owns structural constraints, persistence, indexing, RLS; application code owns heuristics, classifiers, pattern recognition, dynamic relevance ranking, cross-field semantic validation. Memory refresh function in Appendix C is illustrative of the expected SQL surface; actual extraction logic runs in dedicated memory-refresh service via Edge Function or orchestrator webhook. Schema trigger enforces structural invariants only; semantic correctness is the writer's responsibility.

**CR-03A-16 (V2)** — Dedicated service role narrowing added in §17.4. Production deployment requires five dedicated roles: `tutor_runtime_writer`, `tutor_memory_writer`, `tutor_archival_writer`, `tutor_injection_writer`, `tutor_context_reader`. §18 RLS policies using broad `service_role` are illustrative; production migration must substitute dedicated roles per the mapping table. Launch-blocking migration item.

**CR-03A-17 (V2)** — UNIQUE constraint on `tutor_conversations` relaxed to non-unique reuse-lookup index (§18.1). Original runtime contract semantic was "reuse preferred" not "uniqueness enforced." Multiple active conversations per envelope allowed at DB layer; Doc 03B API picks most-recently-updated matching conversation when client requests resume. Addresses CTO pushback on one-active-conversation UX friction (especially for general entry mode).

**CR-03A-18 (V2)** — Emotional register evaluation harness added in §14.8. Precision/recall targets defined per register; Recovery and Elite have 90% precision threshold. V1 launch gating: Recovery and Elite ship in shadow mode (classifier runs and logs, does not affect tone) at launch. Phased enablement to 10% canary then 100% post-launch once precision validated over 2+ weeks of real data. Prevents false-positive tone shifts degrading user experience.

**CR-03A-19 (V2)** — §12A Abuse Controls Beyond Injection added. Six abuse patterns covered: retry storm, bot pattern, account sharing, scraping pattern, quota farming, repeated failure exploit. V1 scope: retry storm active throttling; other patterns logged-only. V2 adds active enforcement. Unified with injection logging in `tutor_injection_log` with specific `detection_layer` values.

**CR-03A-20 (V2)** — §19A Context Layer Observability and Telemetry added. Context build metrics, memory metrics, injection/abuse metrics, policy assignment metrics, cost metrics, quality signals specified. Context-specific SLO targets added to Doc 03 Main §26.B baseline: context build P50 \<150ms, P95 \<400ms, memory freshness P95 \<21 days for active students, injection false positive rate \<10%, trim frequency \<5% of turns. V1 launch dashboards and alert routing defined.

**CR-03A-21 (V2)** — §21A-D V1 Launch Core vs V2 Targets scope callout added paralleling Doc 03 Main §25 pattern. V1 Launch Core enumerates non-negotiable launch scope (must ship). V1 Post-Launch Phased Rollout defines Phase 2 and Phase 3 activation (Recovery/Elite registers, active abuse enforcement). V2 Targets defined (structured extraction expansion, exploration policy mode, active abuse response, streaming). Future Targets noted but not committed.

**CR-03A-22 (V2)** — V2 self-review integration: review scorecard noted 9.4/10 overall with "controlled tightening incremental only" verdict. All CTO pushback items addressed (SQL/code boundary, service role narrowing, context metrics, register eval, conversation constraint). All gap items addressed (observability, abuse controls, V1/V2 scope). COO phasing concern addressed via §21A-D. Cost model and SLO targets referenced rather than duplicated (cross-references to Doc 03 Main §24, §26.B). Incident runbooks remain ops-layer concern, not spec.

**CR-03A-23 (V3)** — V3 established as canonical supersession of V2. Rebase scope: medium against Doc 01 V8 (identity/entitlement) and Doc 01A V1 (platform primitives). V2 architectural decisions preserved; no behavior changes to core context resolution, memory model, injection defense taxonomy, mode/register taxonomy, or schema definitions. Rebase is integration-layer only. Author decisions for V3 rebase locked at scope definition: Q1=b (medium depth — dedupe with 01A \+ preserve structure), Q2=b (abuse detection stays in 03A, enforcement delegates to 01A `AbuseScoreService`), Q3=b (§15 simplifies to `EntitlementService.canAccessFeature` call), Q4=b (scheduled jobs \+ memory refresh use 01A internal service auth), Q5=a (V3.0 with appended change records, V2 history preserved).

**CR-03A-24 (V3)** — §15 Per-Request Entitlement Check simplified to single-call pattern against V8 `EntitlementService.canAccessFeature('tutor_access', studentId)`. V8 §27.3 (including 01A §50 abuse-tier check at step 7\) is authoritative for the allow/deny decision; 03A specifies only LISA-specific wrapper behavior (denial translation table, mid-conversation degraded behavior, observability). Removed direct SQL entitlement reads from LISA code paths. Grace period semantics inherited from V8 §27.3 binary decision; 03A does not reintroduce 03A-layer grace logic.

**CR-03A-25 (V3)** — §12A Abuse Controls rebased per Q2=b. LISA-specific detection stays in 03A (patterns requiring tutor-conversation context to recognize). Enforcement delegates to 01A Part VI `AbuseScoreService` via `recordIncident({studentId, incidentType, severity, context})` emission. 03A no longer maintains scoring logic, tier computation, or enforcement thresholds independently. `tutor_injection_log` retained in 03A for LISA-specific forensic detail (signature matched, detection layer, response substituted) used by safety review queue; `abuse_score_incidents` (01A §55) is the platform-wide ledger for scoring. Dual-write pattern: both tables populated on every detection. Taxonomy alignment: 03A emissions use 01A §52 canonical incident types where available; new LISA-specific types require 01A taxonomy extension, not 03A-unilateral additions.

**CR-03A-26 (V3)** — §12.7 Layer 5 rate limiting rebased to reference 01A Part V `RateLimitLedger`. Launch buckets: `tutor_turns_daily` (primary quota), with flagged turns counting as `cost > 1` to tighten quota faster. Abuse-score tier multipliers (01A §42) apply continuous compression (1.0× / 0.75× / 0.5× / 0.25× / 0×) rather than binary allow/deny. 03A provides inputs; Doc 03B enforces at request boundary; 01A §44 429 response shape is canonical.

**CR-03A-27 (V3)** — §8.6 Mastery read caching added. Mastery reads adopt 01A Part III two-tier cache pattern (in-process \+ Postgres authoritative with LISTEN/NOTIFY invalidation). Cache keys follow 01A §25 convention: `mastery:student:<uuid>:skill:<uuid>`, `mastery:student:<uuid>:domain:<domain>`. Invalidation channel `mastery_invalidate` emitted by Doc 02B mastery write path after commit. Failure behavior: hard-staleness fallback per 01A §24; `CacheUnavailableError` per 01A §0.6 for unrecoverable fetch failures. Launch target P95 cache hit rate \>90% for in-conversation mastery reads.

**CR-03A-28 (V3)** — §9 Memory Refresh Job and §19 Scheduled Jobs integrated with 01A Part VII internal service auth. Four service pairs established: `memory-refresh-scheduler → memory-refresh-worker`, `memory-refresh-worker → main-api`, `archival-scheduler → archival-worker`, `archival-worker → main-api`. HMAC-SHA256 signing per 01A §62 convention; 90-day rotation with 14-day overlap per 01A §65; 5-minute timestamp tolerance per 01A §66. Failure envelopes use 01A error classes; retry behavior bounded to max 1 retry on transient failures with the persistent-failure path handled by next scheduled cycle rather than a retry loop. SQL cron functions are thin schedulers; actual work runs in application code behind HMAC-authenticated endpoints under `/api/internal/*` prefix per 01A §69 reverse-proxy enforcement.

**CR-03A-29 (V3)** — §11.6 policy assignment observability, §19.5 job-level observability, §19A context layer observability rebased onto 01A Part II canonical interfaces. Inherited from 01A: structured logger (01A §11), correlation ID middleware (01A §12), metrics naming convention (01A §15), percentile conventions (01A §16), alert routing (01A §18), PII redaction transport (01A §14 — raw tutor prompts, tutor responses, student answers in blocked-fields list). LISA-specific observability specified: context build metrics, memory freshness metrics, injection/abuse metrics (dual-emission to `tutor_injection_log` \+ `AbuseScoreService.recordIncident`), policy assignment metrics. §19A.7 SLO table updated to reference 01A §74A per-primitive budgets and add composed context-resolution SLOs.

**CR-03A-30 (V3)** — Config rename `tutor_context_config` → `tutor_context_runtime_config` per 01A §8 naming convention. `tutor_injection_signatures` retained as-is (pattern-data table, not `*_runtime_config` scalar table). §21.3 idempotency references 01A Part IV `IdempotencyService` with `tutor_turn` scope; 7-day retention per 01A §34. §0.2 Relationship section updated to enumerate V8 and 01A consumption points. §23 review triggers extended to include V8 and 01A interface changes. Schema governance classes cross-referenced to 01A Appendix D / V8 Appendix E ownership matrix.

---

# **Appendix A — Memory Summary JSON Schemas (Formal)**

## **A.1 teaching\_profile v1.0**

{  
  "$schema": "http://json-schema.org/draft-07/schema\#",  
  "title": "teaching\_profile v1.0",  
  "type": "object",  
  "required": \[  
    "summary\_version",  
    "learning\_style\_signals",  
    "last\_struggled\_skill",  
    "last\_mastered\_skill",  
    "engagement\_summary"  
  \],  
  "additionalProperties": false,  
  "properties": {  
    "summary\_version": {"const": "1.0"},  
    "learning\_style\_signals": {  
      "type": "object",  
      "additionalProperties": false,  
      "properties": {  
        "prefers\_step\_by\_step": {"type": \["boolean", "null"\]},  
        "prefers\_conceptual\_first": {"type": \["boolean", "null"\]},  
        "responds\_well\_to\_analogies": {"type": \["boolean", "null"\]},  
        "prefers\_quick\_explanations": {"type": \["boolean", "null"\]}  
      }  
    },  
    "last\_struggled\_skill": {  
      "type": "object",  
      "additionalProperties": false,  
      "properties": {  
        "canonical\_skill\_id": {"type": \["string", "null"\]},  
        "domain": {"type": \["string", "null"\]},  
        "section": {"enum": \["M", "RW", null\]},  
        "last\_fail\_at": {"type": \["string", "null"\], "format": "date-time"},  
        "fail\_count\_7d": {"type": \["integer", "null"\]},  
        "mastery\_at\_time\_of\_fail": {"type": \["number", "null"\]}  
      }  
    },  
    "last\_mastered\_skill": {  
      "type": "object",  
      "additionalProperties": false,  
      "properties": {  
        "canonical\_skill\_id": {"type": \["string", "null"\]},  
        "domain": {"type": \["string", "null"\]},  
        "section": {"enum": \["M", "RW", null\]},  
        "crossed\_to\_strong\_at": {"type": \["string", "null"\], "format": "date-time"},  
        "prior\_mastery": {"type": \["number", "null"\]},  
        "current\_mastery": {"type": \["number", "null"\]}  
      }  
    },  
    "engagement\_summary": {  
      "type": "object",  
      "additionalProperties": false,  
      "properties": {  
        "typical\_session\_length\_min": {"type": \["integer", "null"\]},  
        "days\_since\_last\_active": {"type": \["integer", "null"\]},  
        "total\_tutor\_turns\_30d": {"type": \["integer", "null"\]}  
      }  
    }  
  }  
}

## **A.2 chat\_compaction v1.0**

{  
  "$schema": "http://json-schema.org/draft-07/schema\#",  
  "title": "chat\_compaction v1.0",  
  "type": "object",  
  "required": \[  
    "summary\_version",  
    "conversation\_id",  
    "source\_window\_start",  
    "source\_window\_end",  
    "turns\_compacted",  
    "topics\_discussed",  
    "skills\_referenced",  
    "key\_insights",  
    "unresolved\_confusion"  
  \],  
  "additionalProperties": false,  
  "properties": {  
    "summary\_version": {"const": "1.0"},  
    "conversation\_id": {"type": "string", "format": "uuid"},  
    "source\_window\_start": {"type": "string", "format": "date-time"},  
    "source\_window\_end": {"type": "string", "format": "date-time"},  
    "turns\_compacted": {"type": "integer", "minimum": 0},  
    "topics\_discussed": {  
      "type": "array",  
      "maxItems": 10,  
      "items": {"type": "string", "maxLength": 100}  
    },  
    "skills\_referenced": {  
      "type": "array",  
      "maxItems": 20,  
      "items": {"type": "string"}  
    },  
    "key\_insights": {  
      "type": "array",  
      "maxItems": 5,  
      "items": {"type": "string", "maxLength": 200}  
    },  
    "unresolved\_confusion": {  
      "type": "array",  
      "maxItems": 5,  
      "items": {"type": "string", "maxLength": 200}  
    },  
    "last\_student\_direction": {"type": \["string", "null"\], "maxLength": 300}  
  }  
}

## **A.3 recent\_learning\_pattern v1.0**

{  
  "$schema": "http://json-schema.org/draft-07/schema\#",  
  "title": "recent\_learning\_pattern v1.0",  
  "type": "object",  
  "required": \[  
    "summary\_version",  
    "window\_days",  
    "sections\_active",  
    "skills\_improved",  
    "skills\_regressed",  
    "skills\_stuck",  
    "attempts\_total",  
    "pass\_rate"  
  \],  
  "additionalProperties": false,  
  "properties": {  
    "summary\_version": {"const": "1.0"},  
    "window\_days": {"type": "integer", "minimum": 1, "maximum": 90},  
    "sections\_active": {  
      "type": "array",  
      "items": {"enum": \["M", "RW"\]}  
    },  
    "skills\_improved": {  
      "type": "array",  
      "maxItems": 5,  
      "items": {  
        "type": "object",  
        "required": \["skill\_id", "mastery\_delta"\],  
        "properties": {  
          "skill\_id": {"type": "string"},  
          "mastery\_delta": {"type": "number"}  
        }  
      }  
    },  
    "skills\_regressed": {  
      "type": "array",  
      "maxItems": 5,  
      "items": {  
        "type": "object",  
        "required": \["skill\_id", "mastery\_delta"\],  
        "properties": {  
          "skill\_id": {"type": "string"},  
          "mastery\_delta": {"type": "number"}  
        }  
      }  
    },  
    "skills\_stuck": {  
      "type": "array",  
      "maxItems": 5,  
      "items": {  
        "type": "object",  
        "required": \["skill\_id", "fail\_count"\],  
        "properties": {  
          "skill\_id": {"type": "string"},  
          "fail\_count": {"type": "integer"}  
        }  
      }  
    },  
    "attempts\_total": {"type": "integer", "minimum": 0},  
    "pass\_rate": {"type": "number", "minimum": 0, "maximum": 1}  
  }  
}

## **A.4 study\_context v1.0**

{  
  "$schema": "http://json-schema.org/draft-07/schema\#",  
  "title": "study\_context v1.0",  
  "type": "object",  
  "required": \[  
    "summary\_version",  
    "current\_focus\_skills",  
    "upcoming\_scheduled\_sessions"  
  \],  
  "additionalProperties": false,  
  "properties": {  
    "summary\_version": {"const": "1.0"},  
    "scheduled\_exam\_date": {"type": \["string", "null"\], "format": "date"},  
    "days\_until\_exam": {"type": \["integer", "null"\]},  
    "current\_focus\_skills": {  
      "type": "array",  
      "maxItems": 10,  
      "items": {"type": "string"}  
    },  
    "plan\_adherence\_7d": {"type": \["number", "null"\], "minimum": 0, "maximum": 1},  
    "missed\_sessions\_7d": {"type": \["integer", "null"\]},  
    "upcoming\_scheduled\_sessions": {"type": "integer", "minimum": 0}  
  }  
}

---

# **Appendix B — Schema Validation Function (Full Implementation)**

CREATE OR REPLACE FUNCTION validate\_memory\_summary\_schema()  
RETURNS TRIGGER AS $$  
DECLARE  
  v\_content JSONB := NEW.content\_json;  
  v\_type TEXT := NEW.summary\_type;  
  v\_version TEXT;  
BEGIN  
  \-- Every summary must have summary\_version  
  IF NOT (v\_content ? 'summary\_version') THEN  
    RAISE EXCEPTION 'Memory summary missing summary\_version';  
  END IF;

  v\_version := v\_content-\>\>'summary\_version';

  IF v\_version \!= '1.0' THEN  
    RAISE EXCEPTION 'Unsupported summary\_version: %', v\_version;  
  END IF;

  \-- Per-type validation  
  IF v\_type \= 'teaching\_profile' THEN  
    IF NOT (v\_content ? 'learning\_style\_signals'  
      AND v\_content ? 'last\_struggled\_skill'  
      AND v\_content ? 'last\_mastered\_skill'  
      AND v\_content ? 'engagement\_summary') THEN  
      RAISE EXCEPTION 'teaching\_profile missing required fields';  
    END IF;

  ELSIF v\_type \= 'chat\_compaction' THEN  
    IF NOT (v\_content ? 'conversation\_id'  
      AND v\_content ? 'source\_window\_start'  
      AND v\_content ? 'source\_window\_end'  
      AND v\_content ? 'turns\_compacted'  
      AND v\_content ? 'topics\_discussed'  
      AND v\_content ? 'skills\_referenced'  
      AND v\_content ? 'key\_insights'  
      AND v\_content ? 'unresolved\_confusion') THEN  
      RAISE EXCEPTION 'chat\_compaction missing required fields';  
    END IF;

    \-- Bounds check  
    IF jsonb\_array\_length(v\_content-\>'key\_insights') \> 5 THEN  
      RAISE EXCEPTION 'chat\_compaction key\_insights exceeds 5 entries';  
    END IF;  
    IF jsonb\_array\_length(v\_content-\>'unresolved\_confusion') \> 5 THEN  
      RAISE EXCEPTION 'chat\_compaction unresolved\_confusion exceeds 5 entries';  
    END IF;  
    IF jsonb\_array\_length(v\_content-\>'topics\_discussed') \> 10 THEN  
      RAISE EXCEPTION 'chat\_compaction topics\_discussed exceeds 10 entries';  
    END IF;

  ELSIF v\_type \= 'recent\_learning\_pattern' THEN  
    IF NOT (v\_content ? 'window\_days'  
      AND v\_content ? 'sections\_active'  
      AND v\_content ? 'skills\_improved'  
      AND v\_content ? 'skills\_regressed'  
      AND v\_content ? 'skills\_stuck'  
      AND v\_content ? 'attempts\_total'  
      AND v\_content ? 'pass\_rate') THEN  
      RAISE EXCEPTION 'recent\_learning\_pattern missing required fields';  
    END IF;

  ELSIF v\_type \= 'study\_context' THEN  
    IF NOT (v\_content ? 'current\_focus\_skills'  
      AND v\_content ? 'upcoming\_scheduled\_sessions') THEN  
      RAISE EXCEPTION 'study\_context missing required fields';  
    END IF;

  ELSE  
    RAISE EXCEPTION 'Unknown summary\_type: %', v\_type;  
  END IF;

  \-- Size bound (10KB max)  
  IF pg\_column\_size(v\_content) \> 10240 THEN  
    RAISE EXCEPTION 'Memory summary exceeds 10KB size bound';  
  END IF;

  RETURN NEW;  
END;  
$$ LANGUAGE plpgsql;

---

# **Appendix C — Memory Refresh Function (Skeleton)**

CREATE OR REPLACE FUNCTION refresh\_tutor\_memory\_summaries()  
RETURNS INTEGER  
SECURITY DEFINER  
AS $$  
DECLARE  
  v\_refreshed\_count INTEGER := 0;  
  v\_student RECORD;  
BEGIN  
  \-- Iterate over active students with activity in last 7 days  
  FOR v\_student IN  
    SELECT DISTINCT me.student\_id  
    FROM mastery\_events me  
    WHERE me.event\_at \> now() \- interval '7 days'  
  LOOP  
    \-- Refresh teaching\_profile including V1 structured fields  
    PERFORM refresh\_teaching\_profile\_for\_student(v\_student.student\_id);

    \-- Refresh recent\_learning\_pattern  
    PERFORM refresh\_recent\_learning\_pattern\_for\_student(v\_student.student\_id);

    \-- Refresh study\_context if relevant  
    PERFORM refresh\_study\_context\_for\_student(v\_student.student\_id);

    v\_refreshed\_count := v\_refreshed\_count \+ 1;  
  END LOOP;

  RETURN v\_refreshed\_count;  
END;  
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION refresh\_teaching\_profile\_for\_student(p\_student\_id UUID)  
RETURNS VOID  
SECURITY DEFINER  
AS $$  
DECLARE  
  v\_last\_struggled JSONB;  
  v\_last\_mastered JSONB;  
  v\_learning\_signals JSONB;  
  v\_engagement JSONB;  
  v\_content JSONB;  
BEGIN  
  \-- Build last\_struggled\_skill from recent mastery\_events with is\_correct=false  
  SELECT jsonb\_build\_object(  
    'canonical\_skill\_id', skill\_id,  
    'domain', domain,  
    'section', section,  
    'last\_fail\_at', max(event\_at),  
    'fail\_count\_7d', count(\*) FILTER (WHERE event\_at \> now() \- interval '7 days'),  
    'mastery\_at\_time\_of\_fail', (  
      SELECT mastery\_score FROM student\_skill\_mastery  
      WHERE student\_id \= p\_student\_id AND skill\_id \= me.skill\_id  
    )  
  )  
  INTO v\_last\_struggled  
  FROM mastery\_events me  
  WHERE student\_id \= p\_student\_id  
    AND is\_correct \= FALSE  
    AND event\_at \> now() \- interval '30 days'  
  GROUP BY skill\_id, domain, section  
  ORDER BY max(event\_at) DESC  
  LIMIT 1;

  \-- Build last\_mastered\_skill from skills that crossed into 'strong' band in last 30 days  
  SELECT jsonb\_build\_object(  
    'canonical\_skill\_id', skill\_id,  
    'domain', domain,  
    'section', section,  
    'crossed\_to\_strong\_at', updated\_at,  
    'prior\_mastery', NULL,  \-- requires historical snapshot lookup  
    'current\_mastery', mastery\_score  
  )  
  INTO v\_last\_mastered  
  FROM student\_skill\_mastery  
  WHERE student\_id \= p\_student\_id  
    AND mastery\_band \= 'strong'  
    AND updated\_at \> now() \- interval '30 days'  
  ORDER BY updated\_at DESC  
  LIMIT 1;

  \-- Engagement summary  
  SELECT jsonb\_build\_object(  
    'typical\_session\_length\_min', NULL,  \-- V2: compute from session data  
    'days\_since\_last\_active', extract(day from now() \- max(event\_at))::integer,  
    'total\_tutor\_turns\_30d', (  
      SELECT count(\*) FROM tutor\_messages  
      WHERE student\_id \= p\_student\_id  
        AND role \= 'student'  
        AND created\_at \> now() \- interval '30 days'  
    )  
  )  
  INTO v\_engagement  
  FROM mastery\_events  
  WHERE student\_id \= p\_student\_id;

  \-- Learning style signals (V1 placeholder; V2 will extract from conversation patterns)  
  v\_learning\_signals := '{"prefers\_step\_by\_step": null, "prefers\_conceptual\_first": null, "responds\_well\_to\_analogies": null, "prefers\_quick\_explanations": null}'::jsonb;

  \-- Assemble content\_json  
  v\_content := jsonb\_build\_object(  
    'summary\_version', '1.0',  
    'learning\_style\_signals', v\_learning\_signals,  
    'last\_struggled\_skill', COALESCE(v\_last\_struggled, '{}'::jsonb),  
    'last\_mastered\_skill', COALESCE(v\_last\_mastered, '{}'::jsonb),  
    'engagement\_summary', v\_engagement  
  );

  \-- Upsert  
  INSERT INTO tutor\_memory\_summaries (  
    student\_id, summary\_type, summary\_version, content\_json,  
    source\_window\_start, source\_window\_end,  
    last\_refreshed\_at, refresh\_trigger  
  ) VALUES (  
    p\_student\_id, 'teaching\_profile', '1.0', v\_content,  
    now() \- interval '30 days', now(),  
    now(), 'nightly\_refresh'  
  )  
  ON CONFLICT (student\_id, summary\_type)  
  DO UPDATE SET  
    content\_json \= EXCLUDED.content\_json,  
    source\_window\_end \= EXCLUDED.source\_window\_end,  
    last\_refreshed\_at \= EXCLUDED.last\_refreshed\_at,  
    refresh\_trigger \= EXCLUDED.refresh\_trigger,  
    updated\_at \= now();  
END;  
$$ LANGUAGE plpgsql;

\-- Similar implementations for refresh\_recent\_learning\_pattern\_for\_student  
\-- and refresh\_study\_context\_for\_student omitted for brevity;  
\-- they follow the same pattern with different source queries.

---

# **End of Doc 03A V3**

**Canonical for Lyceon platform as of 2026-04-23.** **Supersedes Doc 03A V2, Doc 03A V1, prior internal "TUTOR\_CONTEXT\_AND\_MEMORY\_RUNTIME\_CONTRACT" draft, and PDF-06 §5.** **Coordinates with Doc 03 Main V1.1, Doc 02C V4, Doc 02B V4, Doc 01 V8 (identity/entitlement), Doc 01A V1 (platform primitives). Next documents: Doc 03B V3 (API & Runtime Flow, pending rebase), Doc 03C V1 (GCP Orchestration, pending).** **Next review trigger:** Doc 02C schema change; Doc 01 V8 entitlement model or `canAccessFeature` signature change; Doc 01A primitive interface change (config, logger, cache, idempotency, rate limit, abuse score scoring formula or §52 incident taxonomy, internal service auth signing convention); Doc 03 Main persona/mode change; tutor DB migration; V1 Phase 2/3 activation of Recovery/Elite registers.

**V3 scope summary:** Integration-layer rebase of V2 against Doc 01 V8 (identity/entitlement) and Doc 01A V1 (platform primitives canonical). No behavior changes to core context resolution, memory model, injection defense taxonomy, mode/register taxonomy, or schema definitions. Per author decisions Q1=b (medium rebase — dedupe with 01A \+ preserve structure), Q2=b (abuse detection stays in 03A; enforcement delegates to 01A `AbuseScoreService` via `recordIncident` emissions), Q3=b (§15 simplifies to single `EntitlementService.canAccessFeature` call against V8 §27.3), Q4=b (memory refresh and scheduled jobs use 01A Part VII HMAC internal service auth for cross-service callbacks), Q5=a (V3.0 with appended change records CR-03A-23 through CR-03A-30, V2 history preserved). Mastery reads now consume 01A Part III two-tier cache (§8.6). `tutor_context_config` renamed to `tutor_context_runtime_config` per 01A §8 convention. Observability rebased onto 01A Part II canonical logger/metrics/correlation IDs/PII redaction transport — LISA-specific SLOs preserved, generic conventions deferred to 01A. Idempotency at turn boundary (consumed by Doc 03B) uses 01A Part IV `IdempotencyService` with `tutor_turn` scope. Schema governance classes cross-referenced to 01A Appendix D / V8 Appendix E. 30 change records (14 V1 \+ 8 V2 \+ 8 V3). 4 JSON schemas, schema validation function, memory refresh function skeleton (labeled as illustrative per V2 SQL-vs-code boundary rule). V2 targets flagged throughout for post-launch evolution.

