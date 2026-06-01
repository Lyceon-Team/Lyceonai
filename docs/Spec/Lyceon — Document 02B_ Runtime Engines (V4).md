# **Lyceon — Document 02B: Runtime Engines (V4)**

**Version:** 4.0 **Last Updated:** 2026-04-21 **Status:** Authoritative SWE Specification **Owner:** Founder / CTO Review **Governed By:** Document 00, Document 01, Document 02 Preamble V3 **Depends On:** Document 02A (content supply chain produces the inventory this document serves) **Supersedes (within scope):** PDF-03 Practice Engine, PDF-04 Full-Length Exams & Scoring, review-engine sections of PDF-05 Adaptive & Mastery Engine, PDF-QR §10–11 Reaction Policy & Deterministic Variant Selection, instruction-policy layer of PDF-WM World Model Spec **Applies To:** All live learning runtime systems that serve questions, create sessions, collect answers, score exams, enforce reveal rules, run reaction policy, invoke tutor, and emit learning events

---

# **Table of Contents**

1. Purpose and Mission  
2. Scope and Out-of-Scope  
3. Inheritance from Preamble V3  
4. Supersession Declaration  
5. Current-State vs Target-State Doctrine  
6. Naming and Verification Doctrine  
7. Doc 02A Integration Contract  
8. Schema Integration and Canonical Tables  
9. Runtime Surface Model  
10. Core Invariants  
11. End-to-End Runtime Flow  
12. Entitlement Gate System  
13. Freemium Quota Mechanics  
14. Practice Engine  
15. Structured Practice Controls and Selection Logic  
16. Review Engine and Spaced Repetition  
17. Full-Length Exam Engine  
18. Full-Length Exam Adaptive Module 2 Routing  
19. Exam Scoring Pipeline  
20. Reveal Matrix and Enforcement  
21. Tutor Runtime Rules  
22. Session State and Resume Rules  
23. Answer Submission Contract  
24. Reaction Policy Layer  
25. Runtime Event Flow and Mastery RPC  
26. Canonical Runtime Layer and Analytics Export  
27. Rendering Standards  
28. Math Tooling: Desmos and Formula Sheet  
29. Failure Modes  
30. Pipeline Observability  
31. CI / Testing Standards  
32. Security and Integrity Controls  
33. Constants Doctrine  
34. Known Architectural Debt  
35. Change Control  
36. Verification Before Refactor Checklist  
37. Cross-Document Dependencies  
38. Final Principles  
39. Change Records  
40. Worked Examples  
41. Appendix A — Runtime Constants Catalog

---

# **1\. Purpose and Mission**

## **Purpose**

Lyceon's runtime engines are where content becomes learning. The content supply chain governed by Doc 02A produces questions. This document governs everything that happens after — how those questions are served to students, how answers are collected, how sessions persist, how exams are scored, how tutor operates across surfaces, how reveal rules are enforced, how adaptive Module 2 routing works in full-length exams, and how runtime behavior feeds the downstream mastery and analytics layers.

If the content factory is Lyceon's moat, the runtime is where students experience the moat. A brilliant question bank served through a flaky runtime is indistinguishable from a mediocre bank. Conversely, a strong runtime makes modest content feel good. Both must be strong; this document is the second half of making Lyceon's learning core trustworthy.

## **Strategic Mission**

Build production-grade learning engines that feel fast, fair, stable, and trustworthy. The runtime should maximize student confidence (sessions behave predictably), session continuity (students never lose progress), educational value (the right questions at the right times), scoring integrity (exam results are legitimate), deterministic behavior (behavior can be explained and audited), monetization clarity (free vs paid is obvious and fair), and adaptive authenticity (full-length exams route Module 2 like the real SAT).

## **Why This Matters**

Runtime bugs are the most visible bugs in the product. Content errors are often caught by QA or surface slowly through complaints; runtime bugs are experienced immediately and felt acutely. A lost session, a leaked answer, a timer that misbehaves during an exam, an entitlement check that incorrectly paywalls a free feature, or an adaptive Module 2 that routes wrong — each of these is a trust-destroying event. The runtime must be the most reliable part of the system because it is the part students interact with directly and continuously.

---

# **2\. Scope and Out-of-Scope**

## **In Scope**

This document governs practice sessions, review sessions with spaced repetition, full-length exams with adaptive Module 2 routing, question-serving APIs, session persistence and resume, server-authoritative timers, reveal-rule enforcement, tutor runtime access rules, reaction policy (what happens after a wrong answer or a tutor request), runtime session\_items writes and their role as the canonical runtime state record, canonical event emission to the mastery engine via RPC, entitlement gating at the runtime surface, math tooling integration (Desmos, formula sheet), and the constants-in-DB contract that governs all runtime-affecting configuration values.

## **Out of Scope**

This document does not govern content creation or generation (Doc 02A), mastery math internals or KPI computation or projections (Doc 02C — 02B describes how the runtime triggers mastery updates via RPC but defers algorithm details), authentication or identity flows (Doc 01), subscription billing internals (Doc 01), tutor model architecture or prompt engineering internals (future Doc 03 — this document governs when and where tutor is accessible and what context it receives, not how the tutor itself works), study calendar or plan scheduling logic (future Doc 04 — though this document places a flag on calendar priority for review items), or public-facing marketing surfaces (future Doc 05).

The boundary between this document and Doc 02C is exactly this: the runtime **writes finalized outcomes to session\_items, attempts, and rollup tables** and then **calls the mastery RPC** to propagate events into the mastery tier. Doc 02C governs the mastery algorithm, the KPI derivations, and the analytics export. The runtime does not compute mastery; it produces the raw material from which mastery is computed.

---

# **3\. Inheritance from Preamble V3**

This document inherits all Preamble V3 cross-cutting invariants. Particularly load-bearing:

* **INV-02-04** (practice, exams, tutor use the live canonical bank as question truth source) → the selection logic in §15 reads only from the live question bank; no runtime surface reads from staging or from any intermediate store.  
* **INV-02-05** (billing and entitlement rules apply before premium delivery) → every runtime surface checks entitlement before serving premium content; see §12.  
* **INV-02-06** (guardian visibility aggregate-only) → runtime telemetry respects guardian scope; question-level data never reaches family-facing analytics.  
* **INV-02-08** (pre-submit surfaces never receive correct answers or explanations) → the reveal matrix in §20 is the enforcement arm of this invariant at runtime.  
* **INV-02-09** (internal option metadata never appears in client-facing responses) → the runtime serves only student-visible option structures; internal metadata stays server-side.  
* **INV-02-10** (exam family is a parameter) → the runtime treats exam family as configuration; no SAT hardcoding outside of adapters.

The Preamble §12 reveal matrix is the authoritative cross-cutting source of truth on what is revealed where. This document cites and enforces that matrix; it does not redefine it.

---

# **4\. Supersession Declaration**

This document supersedes the following legacy specs within its scope:

* **PDF-03 Practice Engine:** All sections on session lifecycle, question serving, answer submission, resume, guardian visibility for practice, entitlement gating at runtime, and practice API behavior.  
* **PDF-04 Full-Length Exams & Scoring:** All sections on exam lifecycle, timing, scoring pipeline, domain and skill breakdown, guardian visibility for exam data, and exam API behavior. Extended here with adaptive Module 2 routing not present in the original.  
* **PDF-05 Adaptive & Mastery Engine:** The review-engine sections only. Mastery math, adaptive selection algorithms, and event taxonomy remain in scope for Doc 02C.  
* **PDF-QR Question Creation & Reaction Policy:** The reaction policy sections (§10 reaction families, §11 deterministic variant selection). Generation and option metadata sections remain in Doc 02A.  
* **PDF-WM World Model Spec:** The instruction policy layer (§3–§12 covering policy assignments, exposures, forbidden experimentation zones). The modeling export schema remains in PDF-WM until formally absorbed into Doc 02C.

Legacy PDFs move to `docs/old-spec-docs/` as historical reference. Where this document's description of behavior differs from the legacy PDFs, this document governs.

---

# **5\. Current-State vs Target-State Doctrine**

This specification uses two operating lenses throughout.

**Current-State** describes the implementation likely present today or in near-term practical use based on the DB schema audit and repository runtime audit. It may include shortcuts, mid-migration states, legacy tables still receiving writes, or missing features acceptable pre-launch but not acceptable long-term.

**Target-State** describes the preferred mature architecture after controlled migration. It has stronger isolation, tighter contracts, complete feature coverage, and full audit capability.

## **Conflict Resolution Order**

When current-state and target-state conflict, the resolution order is:

1. **Current-state is how the system behaves today.** It is truth for understanding production behavior.  
2. **Target-state is how the system should behave.** It is truth for understanding the destination.  
3. **Before any refactor, engineers verify current state** from actual repository and actual database, not from assumption based on this document.  
4. **Refactors move current toward target.** They do not preserve current state. They do not skip to target without migration.  
5. **Change records document the gap path** from current to target, including migration pre-conditions, rollback strategy, and verification criteria.

Current-state and target-state are not competing truths. They are two snapshots of the same system at different points in time, connected by documented migration paths.

## **Why This Matters**

Runtime specs that describe only target state become fiction because teams cannot tell whether they are working from the spec or from legacy code. Specs that describe only current state become obsolete the moment anything changes. Both lenses together, with an explicit gap and an explicit resolution order, make the spec useful across migration windows. This is particularly important for Lyceon's runtime because the DB has evolved through at least three migration waves — legacy tables still exist alongside canonical ones, and runtime writes still flow through legacy paths in some places.

---

# **6\. Naming and Verification Doctrine**

This document uses actual table and column names **where they have been verified through the DB schema audit and repository audit**. Where names are introduced for target-state components that do not yet exist, they are described by intent and bracketed as proposals subject to verification.

The distinction matters because V4 is drafted with full schema and repo awareness, which means most canonical names are verified. But verification at implementation time is still mandatory because the DB continues to evolve.

## **Verification-Before-Change Discipline**

Every operational section carries a verification callout. Before any team refactors, implements, or changes a component described here, they must gather proof of current behavior from the actual repository, actual database, and actual deployed runtime. They compare that verified truth to this specification. Any divergence is documented and resolved intentionally — either by updating the spec, updating the code, or both, with a change record capturing the decision.

## **Naming Conventions Confirmed at V4**

* Identity: `profiles` canonical with `profiles.id` and `profiles.role`; `users` deprecated  
* Practice: `practice_sessions`, `practice_session_items` (canonical); `practice_events` legacy  
* Review: `review_sessions`, `review_session_items`, `review_error_attempts` (canonical); `review_session_events` legacy; `review_schedule` proposed new table for SM-2  
* Full-length: `full_length_exam_sessions`, `full_length_exam_modules`, `full_length_exam_questions`, `full_length_exam_responses`, `full_length_exam_score_rollups` (canonical); form blueprints split between `test_forms`/`test_form_items` (legacy read) and `exam_forms`/`exam_form_items` (target write); `full_length_adaptive_config` drives Module 2 routing  
* Mastery: `student_domain_mastery`, `student_skill_mastery`, `student_cluster_mastery` (canonical); `mastery_constants` and `kpi_constants` carry math configuration  
* Questions: `public.questions` canonical with `public.questions.id` as SAT{M|RW}{1|2}XXXXXX per Doc 02A §14  
* Embeddings: `copilot.question_embeddings` target (RLS-locked); `public.question_embeddings` legacy flagged for deletion  
* Entitlement: `entitlements` canonical, linked to profile (target model per CR-02B-26); current state routes through legacy `accounts`/`account_members` via RPC, being migrated to direct profile linkage  
* Guardian: `guardian_links` canonical; `profiles.guardian_profile_id` self-reference; `guardian_consent_requests` for consent workflow  
* Under-13: `profiles.is_under_13`, `profiles.guardian_email`, `profiles.guardian_consent`, `profiles.consent_given_at` columns  
* Runtime constants: `practice_runtime_config`, `review_runtime_config`, `exam_runtime_config`, `tutor_runtime_config` (proposed domain-specific tables following the existing `mastery_constants`/`kpi_constants` pattern)

---

# **7\. Doc 02A Integration Contract**

This document consumes content produced by Doc 02A. The integration contract specifies exactly what the runtime reads from the canonical question record, what structures it preserves in session items, and what data flows between 02A outputs and 02B behavior.

## **Fields the Runtime Reads from `public.questions`**

Runtime reads the following fields from the canonical question record to construct session items and serve questions:

* `id` — canonical question identifier (SAT{M|RW}{1|2}XXXXXX format per Doc 02A §14)  
* `section`, `domain`, `skill_codes`, `difficulty` — for selection logic and metadata  
* `stem`, `passage`, `options`, `correct_answer`, `explanation` — for serving and evaluation  
* `option_metadata` — internal-only, never served to clients; used for telemetry and reaction policy  
* `assets` — media and diagrams referenced in the question  
* `active_status` — filter to exclude retired questions from selection  
* `estimated_time_seconds` — used for timing expectations in telemetry  
* `premium_flag` — redundant with entitlement check but informative  
* `version` — for denormalization audit trail

## **Snapshot Writes to Session Items**

When a question is assigned to a session item (practice, review, or full-length), the runtime writes a denormalized snapshot of the question content to the session\_items row. This snapshot includes stem, options, correct\_answer, explanation, domain, skill, difficulty, and the internal option\_metadata.

The snapshot is immutable per INV-02B-13. Updates to the underlying `questions` row do not propagate. If a question is retired after the snapshot, the session item preserves the original content the student saw.

## **Internal Option Metadata Flow**

Per Doc 02A §19, every question has `option_metadata` containing per-option role (correct/distractor) and distractor taxonomy labels. The runtime:

* Writes `option_metadata` into session\_items snapshot for telemetry purposes  
* Never includes `option_metadata` in client-facing responses (INV-02B-01, enforcing INV-02-09)  
* Uses the taxonomy labels when a student selects a distractor — the runtime records which taxonomy was selected for downstream analytics and policy decisions  
* Never allows tutor to see `option_metadata` in review-pre-submit context (prevents answer leakage via tutor)

## **Retired Question Handling**

Per Doc 02A §31, retirement sets `active_status = retired`. Runtime:

* Excludes retired questions from new selection (§15)  
* Preserves retired questions in already-assigned session items (snapshot immutability)  
* Continues to serve retired questions within active sessions until completion

## **Why This Matters**

The 02A/02B boundary is where content becomes learning experience. A misalignment — runtime reading fields 02A doesn't produce, or failing to write fields 02A requires — breaks the entire pipeline. The explicit integration contract prevents silent drift and gives implementation teams a clear source of truth for the cross-spec data contract.

## **Verification Before Refactor**

Before refactoring the 02A integration: inspect current `public.questions` column set, verify which fields are written vs missing, confirm session\_items denormalization captures all required snapshot fields, verify that `option_metadata` is readable by runtime for telemetry and never included in client responses.

---

# **8\. Schema Integration and Canonical Tables**

This section maps runtime responsibilities to actual DB tables as verified through schema and repository audits. Every table reference in V4 is anchored here; downstream sections cite these table names as the canonical truth.

## **Identity and Access**

| Role | Table | Notes |
| ----- | ----- | ----- |
| Identity truth | `profiles` | Canonical; `profiles.id` maps to `auth.uid()` |
| Role resolution | `profiles.role` | Enum values: student, guardian, admin, tutor, teacher (per profile\_role enum) |
| Deprecated legacy | `users` | Still FK target from Wave 1 tables (`attempts`, `audit_logs`, `chat_messages`); not canonical |
| Guardian linkage | `guardian_links`, `profiles.guardian_profile_id` | Canonical guardian-student linking |
| Under-13 consent | `profiles.is_under_13`, `profiles.guardian_email`, `profiles.guardian_consent`, `profiles.consent_given_at` | State columns on profile |
| Consent workflow | `guardian_consent_requests` | Consent request lifecycle |
| MFA | `auth.mfa_factors`, `auth.mfa_challenges`, `auth.mfa_amr_claims` | Supabase-managed |

## **Entitlement and Billing**

| Role | Table | Notes |
| ----- | ----- | ----- |
| Entitlement truth | `entitlements` | Canonical; **target-state links to profile** directly per CR-02B-26 |
| Usage metering | `usage_daily` | Daily usage counters |
| Billing identity | `profiles.stripe_customer_id` | Stripe customer ID on profile |
| Account deletion | `account_deletion_requests` | 7-day soft-delete window |
| Legacy account layer | `accounts`, `account_members` | **Current-state writes via `ensure_account_for_user` RPC**; being migrated out per CR-02B-26 |
| Parallel account tables | `lyceon_accounts`, `lyceon_account_members` | Has policies but may not receive writes; orphaned in current state per CR-02B-24 |

## **Question Bank**

| Role | Table | Notes |
| ----- | ----- | ----- |
| Question truth | `public.questions` | Canonical; authenticated-read per CR-02B-18 |
| Question versions | `question_versions` | Minimal use; no history tracking at MVP per CR-02B-18 |
| Embeddings (target) | `copilot.question_embeddings` | RLS-locked, service\_role only |
| Embeddings (legacy) | `public.question_embeddings` | Flagged for deletion per CR-02B-27 |

## **Practice Runtime**

| Role | Table | Notes |
| ----- | ----- | ----- |
| Session envelope | `practice_sessions` | Canonical; owned by `practice-canonical.ts` |
| Session items \+ finalized outcomes | `practice_session_items` | Canonical; denormalized snapshot \+ answer state |
| Legacy event log | `practice_events` | Phasing out per CR-02B-28; migrate remaining writes to session\_items |
| Deprecated attempt tables | `practice_attempts_v0`, `attempts`, `answer_attempts` | Wave 1 fossils; not canonical |

## **Review Runtime**

| Role | Table | Notes |
| ----- | ----- | ----- |
| Session envelope | `review_sessions` | Canonical; owned by `review-session-routes.ts` |
| Session items \+ snapshot | `review_session_items` | Canonical |
| Outcome attempts | `review_error_attempts` | Per-attempt outcome linked to session items |
| Legacy event log | `review_session_events` | Phasing out per CR-02B-28 |
| SM-2 scheduling | `review_schedule` (proposed new) | Per-(profile, question) scheduling state; target-state addition per CR-02B-23 |

## **Full-Length Exam Runtime**

| Role | Table | Notes |
| ----- | ----- | ----- |
| Session envelope | `full_length_exam_sessions` | Canonical; owned by `fullLengthExam.ts` |
| Module state | `full_length_exam_modules` | Per-module lifecycle including Module 2 routing decision |
| Question snapshots | `full_length_exam_questions` | Per-session prefilled question snapshots |
| Answer surface | `full_length_exam_responses` | Per-response records |
| Scoring rollups | `full_length_exam_score_rollups` | Per-session scoring outputs |
| Form blueprint (current read) | `test_forms`, `test_form_items` | Legacy read path in `fullLengthExam.ts` |
| Form blueprint (target write) | `exam_forms`, `exam_form_items` | Canonical write path in `exam-form-write.ts`; migration incomplete per CR-02B-21 |
| Adaptive config | `full_length_adaptive_config` | Module 2 routing thresholds and parameters |

## **Tutor Runtime**

| Role | Table | Notes |
| ----- | ----- | ----- |
| Interactions | `tutor_conversations`, `tutor_messages`, `tutor_question_links` | Owned by `tutor-runtime.ts` |
| Policy assignments | `tutor_instruction_assignments` | Reaction policy assignment records |
| Exposures | `tutor_instruction_exposures` | What variants were actually shown |
| Legacy log | `tutor_interactions` | Application-layer log via `tutor-log.ts` |

## **Mastery (02C Scope, Read-Only from 02B)**

| Role | Table | Notes |
| ----- | ----- | ----- |
| Domain-tier mastery | `student_domain_mastery` | Read-only at runtime; written only via RPC |
| Skill-tier mastery | `student_skill_mastery` | RLS `no_direct_write` policy; written only via RPC |
| Cluster-tier mastery | `student_cluster_mastery` | RLS `no_direct_write` policy; written only via RPC |
| Constants | `mastery_constants` | Mastery math configuration (alpha, deltas, multipliers, boundaries) |
| KPI constants | `kpi_constants` | KPI weights and scaling |
| Current rollups | `student_kpi_rollups_current` | Derived view |
| Section projections | `student_section_projections` | Derived view |

## **Runtime Configuration (Proposed Target-State Tables)**

| Role | Table | Notes |
| ----- | ----- | ----- |
| Practice runtime config | `practice_runtime_config` | Quota size, reset timezone, session defaults, inactivity, recency window |
| Review runtime config | `review_runtime_config` | SM-2 intervals, ease factors, graduation thresholds |
| Exam runtime config | `exam_runtime_config` | Section durations, break duration, reconnect behavior |
| Tutor runtime config | `tutor_runtime_config` | Rate limits, review answer-withhold mode, exam invocation response |

See §33 and Appendix A for the complete constants catalog.

## **Canonical Writer Map**

| Domain | Canonical Writer | Tables Owned |
| ----- | ----- | ----- |
| Practice runtime | `practice-canonical.ts` | practice\_sessions, practice\_session\_items, practice\_events (legacy phase-out) |
| Review runtime | `review-session-routes.ts` | review\_sessions, review\_session\_items, review\_error\_attempts, review\_session\_events (legacy phase-out), review\_schedule (target) |
| Full-length exam | `fullLengthExam.ts` | full\_length\_exam\_sessions, full\_length\_exam\_modules, full\_length\_exam\_questions, full\_length\_exam\_responses, full\_length\_exam\_score\_rollups |
| Tutor runtime | `tutor-runtime.ts` | tutor\_conversations, tutor\_messages, tutor\_question\_links, tutor\_instruction\_assignments, tutor\_instruction\_exposures |
| Question publishing (Doc 02A) | `question-publish.ts` | questions, question\_versions |
| Mastery RPC caller | `mastery-write.ts` | Invokes `apply_learning_event_to_mastery` RPC |
| Account/billing orchestrator | `account.ts` \+ `ensure_account_for_user` RPC | guardian\_links, entitlements, usage\_daily (`account.ts` orchestrates; RPC performs atomic account-and-entitlement creation; not two independent writers) |
| Exam forms (target) | `exam-form-write.ts` | exam\_forms, exam\_form\_items |
| Account deletion | `account-deletion-routes.ts` | account\_deletion\_requests (Doc 01 scope; listed here for runtime awareness of cross-domain writes) |
| Legal acceptances | `legal-routes.ts` | legal\_acceptances (Doc 01 scope) |
| Stripe webhook idempotency | `webhookHandlers.ts` | stripe\_webhook\_events (Doc 01 scope) |
| Question feedback | `questions-runtime.ts` | question\_feedback |

## **Prefill Timing Variation by Surface**

The prefill pattern varies by surface based on selection determinism at session creation time:

* **Practice:** Selection is fully determined at session creation (fixed target count, fixed filters, runs once, prefill all session\_items). §14 documents this.  
* **Review:** Queue-based, no session-creation prefill per se. Due items surface continuously; no session-scoped materialization. §16 documents this.  
* **Full-length:** Module 1 is deterministic at session creation (same for all students taking the form). Module 2 requires Module 1 outcome for adaptive routing. Prefill is two-staged: Module 1 at session creation, Module 2 at Module 1 submission after routing. §17 and §18 document this.

This variation is intentional. An engineer implementing one surface should not assume the others use identical timing.

## **Why This Matters**

The runtime's correctness depends on writing to and reading from the right tables. Prior drafts of 02B described behavior in naming-abstracted terms; V4 grounds the spec in verified DB truth. Engineers implementing from this spec now have a table-level map for every runtime responsibility, and the prefill variation across surfaces is explicit rather than inferred.

## **Verification Before Refactor**

Before any runtime implementation touching these tables: verify the canonical writer is still the only writer (multi-writer debt per §34), confirm the read paths match what's documented, check whether any legacy phase-out tables (`practice_events`, `review_session_events`, `public.question_embeddings`) are still being written to beyond expected migrations.

---

# **9\. Runtime Surface Model**

Lyceon's runtime exposes three primary learning surfaces to students, plus a tutor layer that crosses them.

**Practice** is the core learning loop. It is frequent, low-friction, autonomous. Students choose filters or accept defaults, answer questions at their own pace, get immediate feedback after each submission, and learn through repetition of attempting and reviewing explanations. Practice is where most learning hours live.

**Review** is the mistake-recovery and deep-learning surface. When a student gets a practice or exam question wrong, that question enters their review queue. Review replays the original missed question (not a similar-question variant) with tutor assistance available **before submission** — the student reasons through the question with tutor support, submits, and sees whether they understood. Review is governed by spaced repetition: correctly retrieved items resurface at expanding intervals; missed items resurface sooner. This is where durable learning happens.

**Full-Length Exams** are trust-anchor assessments. They simulate the real SAT with strict timing, no tutor, no mid-exam reveals, official-style scoring, and **adaptive Module 2 routing** that matches real SAT digital behavior. Full-length results inform mastery heavily because they are high-integrity signal. Students take exams periodically to measure progress, not as a daily activity.

**Tutor** crosses the three surfaces with behavior that varies by surface. In practice, tutor is a post-submission explanation deepener. In review, tutor is a pre-submission Socratic partner. In active exam, tutor is absent from the UI and invocation is soft-nudged with a warning if invoked via other paths.

## **Why This Matters**

Conflating surfaces produces both bad product and bad learning outcomes. If practice and review behave identically, students don't distinguish between casual reps and deliberate concept learning. If exams feel like practice, the exam's trust-anchor value collapses. If full-length exams use static forms without adaptive Module 2, they don't match real SAT behavior and the measurement validity drops. If tutor behaves the same everywhere, students who need pre-submission reasoning help can't get it (practice reveals too early) and students who need post-submission explanation get too little help (review withholds the answer). Surface-aware design is what makes each role work.

---

# **10\. Core Invariants**

### **INV-02B-01 (elaborates INV-02-08)**

No correct answer, explanation, or internal option metadata may reach any client-facing surface before the student has submitted the answer for that question.

### **INV-02B-02**

All session item writes and answer submissions are idempotent. Re-submission of the same logical attempt produces the same recorded outcome without duplicate rows.

### **INV-02B-03 (elaborates INV-02-05)**

Entitlement is checked server-side before any gated runtime action. Client-side entitlement claims are never trusted.

### **INV-02B-04**

Practice and review prioritize learning value. Full-length exams prioritize integrity. Tradeoffs between convenience and integrity resolve in favor of integrity for exam surfaces and in favor of learning for practice and review surfaces.

### **INV-02B-05**

Tutor is absent from the UI during active full-length exams. Server-side tutor invocations during an active exam produce a warning-nudge response and are logged to telemetry for audit; they are not hard-blocked.

### **INV-02B-06**

The runtime writes to canonical session\_items and attempts tables. The runtime does not compute mastery, KPIs, or projections directly; mastery updates are triggered by calling the `apply_learning_event_to_mastery` RPC per §25.

### **INV-02B-07**

Question selection is explainable and deterministic within its stated rules. For any served question, the reason it was selected (filter match, weakness prioritization, freshness, tie-break seed) is reconstructable from recorded state.

### **INV-02B-08**

UI failures degrade gracefully. A failed asset load, a dropped connection, or a rendering error does not destroy session progress. Session state is server-authoritative.

### **INV-02B-09**

Students can resume eligible unfinished work. Practice sessions are resumable within an inactivity window. Full-length exam sessions are resumable only within the exam's original time window; after expiry, the exam is treated as completed with partial answers scored.

### **INV-02B-10**

Full-length exam timers are server-authoritative and continuous. They run regardless of client connectivity. Zero grace period is applied on reconnection.

### **INV-02B-11**

Tutor interactions are logged to telemetry but do not currently emit mastery-bearing events. Mastery comes from unaided attempts only. This is a deliberate simplification superseding PDF-05 §7.3.

### **INV-02B-12**

Reaction policy assignments and instruction exposures are recorded once per decision, immutably. The runtime does not retroactively edit recorded assignments; corrections happen through new records, not mutation.

### **INV-02B-13**

Session item snapshots are immutable once written. Updates to the underlying `public.questions` row (revisions, retirements) do not propagate to assigned session items. This preserves academic integrity (students see what they answered) and enables audit replay.

### **INV-02B-14**

Full-length exam Module 2 routing is server-authoritative. The routing decision is computed from Module 1 raw score against thresholds in `full_length_adaptive_config` and is not influenced by client state. Clients receive the routed module's questions; clients do not choose and the routed variant label is not disclosed in API responses.

### **INV-02B-15**

Runtime constants live in DB configuration tables following the `mastery_constants` and `kpi_constants` pattern. No magic numbers in runtime code affecting user-visible behavior, timing, pricing, or learning algorithm. Every such value is read from the appropriate domain-specific constants table at runtime. Test coverage required to enforce this rule (§31).

---

# **11\. End-to-End Runtime Flow**

Every runtime interaction follows a lifecycle:

1. **Authentication context** — the server validates the student's session token via Supabase Auth and loads identity from `profiles`.  
2. **Entitlement check** — the server validates that the requested action is within the student's tier allowances (free or premium) and, for free users on practice, within remaining daily quota.  
3. **Session create or resume** — a new session is created (practice\_sessions, review\_sessions, or full\_length\_exam\_sessions) or an existing eligible session is resumed. Session state is server-authoritative.  
4. **Prefill session items** — at session creation (for practice and full-length Module 1), the server runs selection logic once and writes all target\_count question assignments as rows in the session\_items table with a position/ordinal and denormalized snapshot. Full-length Module 2 is prefilled after Module 1 submission and routing (§18). Review does not prefill per session.  
5. **Question render** — when the client requests the next question, the server returns the next unanswered session\_item's student-visible payload only. No correct answer, no explanation, no internal metadata.  
6. **Student action** — the student submits an answer, invokes tutor, requests a hint, or performs another runtime interaction.  
7. **Submit and persist** — the server validates the action, persists the outcome idempotently onto the session\_item (for practice/review) or response table (for exam), and triggers the mastery RPC per §25.  
8. **Reveal** — after submit, the runtime reveals the correct answer, explanation, and any post-submit content according to the surface's reveal rules (§20).  
9. **Mastery propagation** — the runtime calls `apply_learning_event_to_mastery` with the event payload; the RPC updates mastery tables atomically.  
10. **Continue or complete** — the session advances to the next session\_item or transitions to a completed state.

Every runtime surface maps cleanly to this lifecycle. The specific implementation differs by surface (practice vs review vs exam) but the structural flow is the same.

## **Why This Matters**

The prefill-and-serve-from-persistence pattern is foundational for everything downstream: resume safety, idempotency, multi-tab handling, anti-leak, analytics, tutor context, and audit replay. A runtime that generates questions on-demand at serve time creates ambiguity about what the student was actually offered. A runtime that prefills creates a canonical trail every downstream system can reason about.

---

# **12\. Entitlement Gate System**

## **Free Tier**

Free users receive access to the practice surface with a daily question quota (§13), basic account features, and the static canonical explanation on each submitted practice question (the explanation field from the question record, not interactive tutor). Free users also see a final-score projection (single overall score prediction) computed from their mastery.

## **Premium Tier**

Premium users receive unlimited practice, full review with spaced repetition and interactive tutor, full-length exams, tutor in practice and review (absent in active exams), complete mastery breakdown including domain-level and skill-level detail and the competency map, historical trend data, calendar and study plan, and all future premium features.

## **Entitlement Matrix**

| Feature | Free | Premium |
| ----- | ----- | ----- |
| Practice questions per day | Per `practice_runtime_config.daily_quota_free` (40 at launch) | Unlimited |
| Static canonical explanation post-submit in practice | Yes | Yes |
| Interactive tutor in practice | No | Yes |
| Interactive tutor in review | No | Yes |
| Review queue access | No (entries accumulate for post-upgrade reveal) | Yes |
| Spaced repetition | No | Yes |
| Full-length exams | No | Yes |
| Overall score projection (single number) | Yes | Yes |
| Section-level projection | Yes | Yes |
| Domain-level mastery breakdown | No | Yes |
| Skill-level mastery breakdown | No | Yes |
| Competency map / mastery hexagon | No | Yes |
| Historical trend data | No | Yes |
| Study calendar | No | Yes |
| Desmos graphing calculator | Yes (math surfaces) | Yes |
| Formula sheet | Yes (math surfaces) | Yes |

## **Entitlement Resolution Flow**

Runtime entitlement checks read from `entitlements` table. In the target-state model (per CR-02B-26), entitlement is linked directly to `profiles.id`. In the current-state model, the `ensure_account_for_user` RPC creates an `accounts` row, an `account_members` row, and an `entitlements` row linked to the account. `account.ts` orchestrates and calls the RPC as a bootstrap step; they are not independent writers. Both paths terminate at the same answer: is the student's entitlement active/premium or free.

## **Guardian-Paid Student Entitlement**

When a guardian pays for a student, entitlement lives on the student's profile. Guardian payment is captured via `guardian_links` but the entitlement record is scoped to the student. The student is treated as premium at runtime regardless of who paid. Guardian access to the student's data is separately governed by guardian visibility rules (aggregate-only per INV-02-06).

This resolves a common confusion: "who is the premium user?" Answer: the student whose profile has an active entitlement. Payment source does not change runtime entitlement semantics.

## **Mastery Compute for All Users**

Mastery is computed for both free and premium users by Doc 02C via the RPC. Free users' mastery is stored but not shown in detail. When a user upgrades, they see their accumulated mastery data retroactively — the full history of their practice time is unlocked as a conversion reward. This is a deliberate design choice: the upgrade moment reveals accumulated value rather than starting from zero.

## **Review Entry Accumulation for Free Users**

When a free user misses a practice question, a review queue entry is created in `review_session_items` (or via the target-state `review_schedule` table). Free users cannot access the review surface, so these entries accumulate invisibly. Upon upgrade, the full review queue is visible and actionable. Free users do not see a teaser count for accumulated review items — visibility is either fully hidden (current-state) or fully revealed post-upgrade; no intermediate state to avoid freemium friction.

## **Desmos and Formula Sheet Availability**

Desmos and the formula sheet are available to all users (free and premium) on math surfaces regardless of tier. These are not premium gates; they are part of the runtime UI for math questions because denying free users basic SAT tools would make the practice experience pedagogically broken. The UI entitlement for math tools is part of the overall runtime surface, not a standalone feature gate.

## **Why This Matters**

Freemium architecture is a product thesis, not just a pricing decision. Lyceon's thesis is that practice alone is an insufficient SAT prep experience — students need review (to consolidate learning), tutor (to understand their mistakes), mastery insight (to know what to work on), exams (to measure progress), and a study plan (to organize their time). The free tier gives enough practice to establish a habit and prove question quality; everything else is the product.

## **Tradeoff Documentation**

Accepting no-free-tutor and no-free-review means some free users will churn before experiencing the product's core value. The counter-strategy is strong practice UX (high question quality, clean interface, Desmos integration) and a compelling final-score projection that creates curiosity about what the premium breakdown reveals. The bet is that converted users are more valuable than the churned users who would have converted with a richer free tier. This is revisable based on conversion data post-launch.

## **Verification Before Refactor**

Before refactoring entitlement enforcement: inspect current entitlement check points in `account.ts` and entitlement-gated routes, verify which table `ensure_account_for_user` currently writes to (legacy `accounts`/`account_members`), confirm whether migration to direct profile linkage has begun, verify entitlement policy on `entitlements` table matches the actual read path.

---

# **13\. Freemium Quota Mechanics**

## **Quota Contract**

Free users may submit up to `practice_runtime_config.daily_quota_free` practice questions per calendar day (40 at launch). The day resets at `practice_runtime_config.quota_reset_timezone` midnight (America/Chicago at launch).

## **Reset Algorithm**

A submitted practice question counts against the quota until the next midnight in the configured timezone. At that moment, the quota refreshes to the configured daily value. All free users see the reset at the same instant.

The fixed-time global reset is an intentional product choice. Competitors with daily quotas (games, language apps, dating apps) reset at a predictable global time to create anticipation UX — users know when their quota refreshes and the wait creates engagement. Rolling 24-hour windows don't produce this effect because the refresh is continuous. Fixed time also simplifies engineering substantially.

US Central was chosen as the launch reset zone because it covers continental US roughly centrally and matches Lyceon's operational timezone. Students in Hawaii see their quota reset at 8pm local; students in New York see it at 1am local. This is acceptable for a US-focused product.

## **Quota Check Mechanism**

When a free user starts a practice session or requests the next question in an active session, the server checks how many practice questions they have submitted since the most recent midnight in the configured timezone. If the count is below the daily quota, the action proceeds. If it is at the quota, the action is rejected with a quota-exhausted response.

Implementation approach: query against `practice_session_items` counting submissions where `answered_at >= today_midnight_configured_timezone` for the profile. Can be optimized with a cached per-profile daily counter.

## **Pre-Cap at Session Creation**

Session creation pre-caps the target count at remaining quota per CR-02B-19. A free user with 2 questions remaining can only start a session with target up to 2\. If the user selects a larger count (via Max button, presets, or custom input), the server returns the session with target count adjusted to remaining quota and surfaces a CTA at session start rather than mid-session.

This prevents the "start a 20-question session, hit quota at question 2, see CTA" mid-session surprise.

## **Zero Quota Remaining**

If a free user has 0 questions remaining and attempts to start a session, the server refuses session creation and returns a quota-exhausted response with countdown to next reset. No session is created with target=0. The client displays the quota-exhausted state with upgrade CTA and countdown timer.

## **Session Count UX**

Client presents presets (5, 10, 15, 20, Max) with a custom input for odd counts. "Max" adapts by tier:

* Free user's Max \= remaining daily quota  
* Premium user's Max \= `practice_runtime_config.max_session_count_premium` (60 at launch, roughly an hour of study)

Custom count bounded to 1 to `practice_runtime_config.max_session_count_premium`. Constants for these bounds live in the runtime configuration table per INV-02B-15.

## **Overnight Session Handling**

If a free user starts a session before the reset boundary and does not complete it before the reset, the session auto-abandons at the inactivity timeout (`practice_runtime_config.inactivity_timeout_hours`, 24 at launch). The student does not resume across the midnight boundary; they start a fresh session with quota reset. This is the "session does not extend across days" rule per locked direction.

## **What Counts Against Quota**

Only practice question submissions count against the daily quota. Specifically excluded:

* Questions served but not answered (abandoned session, browser close before submit)  
* Questions viewed in review surfaces (review is premium-only anyway)  
* Exam questions (exams are premium-only)

## **Why This Matters**

The quota is the product's conversion mechanism. It must feel fair (clear rules, predictable reset, no gotchas) and just tight enough to create upgrade desire without feeling punitive. The anticipation mechanic of a fixed reset time is a deliberate engagement driver.

## **Verification Before Refactor**

Before implementing or refactoring quota mechanics: inspect current quota tracking (if any exists — may not yet be implemented pre-launch), verify the timezone handling, confirm the response shape for quota-exhausted requests, inspect CTA rendering on the client for quota exhaustion.

---

# **14\. Practice Engine**

## **Purpose**

The practice engine is Lyceon's core learning loop. Students engage with it frequently, often daily. It is the hook for free users and the habit for premium users.

## **Canonical Writer**

`practice-canonical.ts` is the canonical writer for practice tables.

## **Lifecycle**

A practice session progresses through states: created (session record exists, no items answered), active (at least one question has been answered), completed (target count reached or user explicitly ended), abandoned (inactivity timeout crossed). State transitions are server-only; clients do not dictate transitions.

## **Session Creation**

The client requests a new practice session with a mode (flow adaptive or structured filtered), optional filters (section, domain, skill, difficulty), a target question count, a platform indicator (web/mobile), and a client instance identifier for multi-tab safety.

The server validates authentication, checks entitlement (free tier pre-caps target against remaining quota; premium unlimited), validates filters against the question bank, creates the `practice_sessions` row, runs selection logic once for the full target count, writes all selected items as `practice_session_items` rows with position ordinals and denormalized question snapshots, and returns the session identifier.

Default target count is `practice_runtime_config.default_session_count_web` (20 at launch) on web and `practice_runtime_config.default_session_count_mobile` (10 at launch) on mobile. Students can override within bounds.

## **Session Items Prefill Pattern**

At session creation, all target\_count session items are materialized immediately. Each `practice_session_items` row carries:

* Link to `practice_sessions`  
* Position/ordinal within the session  
* Reference to `public.questions.id`  
* Denormalized snapshot: stem, passage, options, correct\_answer, explanation, domain, skill, difficulty, section, option\_metadata  
* Item status: pending, served, answered, skipped  
* (Populated on submission) selected\_answer, is\_correct, outcome, time\_spent\_ms, client\_attempt\_id, answered\_at

This is the prefill pattern per CR-02B-20. The snapshot is immutable per INV-02B-13.

## **Serving Questions**

When the client requests the next question in an active session, the server loads the session, validates client\_instance\_id, finds the next pending-or-served session\_item (by ordinal), and returns a student-visible payload containing only the question stem, passage (if applicable), options with keys and text, and assets. The payload does **not** include correct\_answer, explanation, or option\_metadata. This enforces INV-02B-01 at the endpoint level.

On resume (client requests next question but the most recently served item has not been answered), the server returns the same unanswered session\_item rather than advancing. This prevents duplicate items on refresh and ensures the student's session state is preserved across browser or network interruptions.

## **Answer Submission**

The client submits an answer with the session\_item identifier, the selected answer key, the client-reported latency (for telemetry only; not authoritative), and an idempotency key (client\_attempt\_id). The server validates ownership, checks idempotency (if the same client\_attempt\_id has been submitted before, return the prior result), fetches the canonical question data from the session\_item snapshot (not from live `public.questions` — per snapshot immutability), evaluates correctness, persists the outcome onto the session\_item row, and triggers the mastery RPC per §25.

The response to the client includes the correctness outcome, the correct answer key from the snapshot, the explanation text from the snapshot, and (if premium) any interactive tutor affordances. No option\_metadata is included.

## **Immediate Reveal**

Practice reveals correct answer and explanation immediately after submission. This is the fastest feedback loop in the product and is central to practice's role as a rapid learning rep.

## **Resume Behavior**

If a student closes the browser or loses connectivity during an active practice session, they can resume. On return, the system offers to resume the most recent active session or start a new one. If they choose resume, the session continues from where they left off with the already-prefilled session\_items; no new items are selected.

Inactivity timeout transitions an active session to abandoned after `practice_runtime_config.inactivity_timeout_hours`. Abandoned sessions are not resumable.

## **Idempotency**

Every answer submission is idempotent via the client-provided client\_attempt\_id. Double-clicks, network retries, and concurrent tab submissions that share the same client\_attempt\_id produce a single recorded submission. Idempotency scope is per session\_item (UNIQUE on `user_id, client_attempt_id`).

## **Entitlement at Runtime**

Free-tier practice is gated by the daily quota. Each answer submission decrements the day's remaining quota. When quota reaches zero, further question requests return quota-exhausted responses until the next reset.

## **Why This Matters**

Practice is where most sessions happen and most learning hours accumulate. If practice feels unreliable — sessions lost on refresh, duplicate questions on reconnect, slow question loading, broken idempotency causing duplicate answer writes — the product feels broken even if every other system works.

## **Verification Before Refactor**

Before refactoring practice engine behavior: inspect `practice_session_items` schema to confirm denormalized snapshot columns, verify idempotency implementation on answer submissions (UNIQUE constraint on client\_attempt\_id), confirm the prefill pattern is actually implemented (not on-demand selection), verify `practice_events` write paths are migrating to session\_items, test resume behavior for duplicate-item prevention.

---

# **15\. Structured Practice Controls and Selection Logic**

## **Structured Practice Controls**

Students can filter practice by section (M for Math, RW for Reading and Writing), domain (SAT blueprint domains within each section), skill (atomic instructional units within each domain — matches `skill_codes` on questions), difficulty (1, 2, or 3 per Doc 02A INV-02A-05), and count (target number of questions).

Flow practice applies minimal filters (all sections, all domains, all difficulties) and relies on adaptive ranking. Structured practice applies user-specified filters and ranks within them.

## **Selection Philosophy**

Selection is hybrid configurable. User filters are honored strictly. Within the eligible pool, selection ranks by pedagogical priority: weakest skills first (per current mastery data from `student_skill_mastery`), freshness (prefer items the student has not seen recently within `practice_runtime_config.recency_window_days`), and deterministic tie-breaking (seeded Fisher-Yates shuffle for stable ordering).

## **Selection Algorithm**

The selection process is deterministic given inputs, which makes it auditable and testable.

**Step 1 — Eligibility filter.** From `public.questions`, select questions matching the student's filter criteria: section, domain, skill\_codes, difficulty. Exclude `active_status = retired`. Exclude questions already assigned to session\_items in the current active session.

**Step 2 — Pedagogical ranking.** Within the eligible pool, rank by weakness (skills with lower mastery score in `student_skill_mastery` surface first). This implements adaptive selection within user-chosen constraints.

**Step 3 — Freshness preference.** Within skills of equivalent weakness, prefer items the student has not attempted recently. Recency window lives in `practice_runtime_config.recency_window_days` (14 at launch).

**Step 4 — Deterministic tie-break.** For items of equivalent weakness and freshness, apply a Fisher-Yates shuffle seeded by a stable hash of `profile_id + filter_hash + session_id`. This produces consistent ordering for the same inputs while providing variety across sessions.

**Step 5 — Cold start.** If the student has no mastery data (first session), skip the weakness ranking and apply blueprint-balanced sampling. Freshness and tie-break still apply.

## **Repeat Avoidance Strategy**

Lyceon does not maintain a per-student item-seen ledger. Repeat avoidance is solved by growing the question bank to sufficient volume (target 500,000+) so Fisher-Yates selection produces negligible repeat probability. Pre-launch and early-launch, bank volume is lower and repeat probability is higher; the freshness preference mitigates without requiring exposure tracking. If students feel repetition during early launch, the resolution is to accelerate content generation via Doc 02A, not to engineer more complex suppression.

## **Why This Matters**

Selection is where the content bank becomes individualized learning. Deterministic selection matters for debugging — when a student says "why did I get this question?", the answer is reconstructable from state. Mastery-aware ranking within user filters gives both user control and system intelligence.

## **Verification Before Refactor**

Before refactoring selection logic: inspect current selection algorithm in `practice-canonical.ts`, verify which ranking signals are currently used, confirm the mastery-read integration (reads from `student_skill_mastery` via appropriate query path), inspect the current recency-check implementation, test selection determinism by replaying the same inputs.

---

# **16\. Review Engine and Spaced Repetition**

## **Purpose**

Review is where learning consolidates. When a student gets a practice or exam question wrong, that specific question enters their review queue. Over time, spaced repetition surfaces it at scheduled intervals. Students reason through the question with tutor assistance before submitting, submit an answer, and either graduate the item from review (correct enough times at expanding intervals) or reset its schedule (if they missed it).

This is not a similar-question remediation loop. It is deliberate repetition of the specific missed item because the pedagogical goal is concept mastery through spaced practice, not general weakness drilling.

## **Canonical Writer**

`review-session-routes.ts` is the canonical writer for review tables.

## **Launch Scope Matrix**

| Review capability | Launch | Target state |
| ----- | ----- | ----- |
| Original-item replay | Yes | Yes |
| Premium-only review access | Yes | Yes |
| Tutor pre-submit with architectural answer-withholding | Yes | Yes |
| `review_schedule` table | Yes, if feasible at launch | Yes |
| Full SM-2 interval growth | No | Yes |
| One-success graduation (simplified) | Yes | No |
| Graduated-item resurfacing logic | Minimal | Full |
| Tutor-assisted correctness equivalence | Yes (at launch; revisit with data) | Revisit |
| `used_tutor` flag captured | Yes | Yes |
| Review entry creation for free users | Yes (invisible accumulation) | Yes |

Launch ships original-item replay with simplified graduation (one correct retry graduates). Schema supports full SM-2 from the start. Target state enables full SM-2 as a pure logic change with no schema migration.

## **Entry to Review**

A question enters a student's review queue when they answer it incorrectly in practice or exam. Skipped questions (served but not submitted) do not enter review. Review entry is automatic; students do not opt in or out per question. Review entries are created for all users regardless of tier (free users accumulate invisibly per §12).

## **Spaced Repetition Model — SM-2 (Target State)**

Lyceon uses the SM-2 algorithm at target state (the algorithm Anki and Quizlet use for the same pedagogical goal).

Each review item tracks:

* `repetition_count`: how many consecutive successful retrievals have occurred  
* `interval_days`: current interval (in days) until next scheduled review  
* `ease_factor`: multiplier controlling how fast intervals grow (default from `review_runtime_config.sm2_initial_ease_factor`, 2.5 at launch)  
* `next_review_at`: timestamp of next scheduled review

When a student reviews an item and gets it correct, the repetition count increments. On the first successful retrieval the interval is `review_runtime_config.sm2_initial_interval_days` (1 at launch). On the second it is `review_runtime_config.sm2_second_interval_days` (6 at launch). Subsequent intervals multiply by the ease factor. The ease factor adjusts slightly upward on success (capped at `review_runtime_config.sm2_ease_factor_max`). After `review_runtime_config.sm2_graduation_repetition_count` consecutive successes (5 at target state; 1 at launch), the item graduates — it drops out of the active review queue.

When a student reviews an item and gets it wrong, the repetition count resets to zero, the interval resets to `review_runtime_config.sm2_initial_interval_days`, the ease factor decreases slightly (floored at `review_runtime_config.sm2_ease_factor_min`, 1.3 at launch). The item resurfaces tomorrow.

## **Review Schedule Table (Target State)**

SM-2 scheduling requires per-(profile, question) state that persists beyond any individual session. Current `review_sessions` / `review_session_items` / `review_error_attempts` tables are session-bound and don't model per-(profile, question) scheduling.

V4 proposes a new `review_schedule` table capturing the SM-2 state:

* Link to `profiles.id`  
* Link to `public.questions.id`  
* `repetition_count`, `interval_days`, `ease_factor`, `next_review_at`  
* Lifecycle status: active, graduated, retired  
* First-missed context (session where the miss occurred)

This is a target-state addition per CR-02B-23. Names subject to verification at implementation time per naming doctrine.

## **Item-Level Scheduling, Session-Level UX**

Scheduling is per-item: each (profile, question) pair has its own SM-2 state. The UI presents items as a daily review session for affordance (students engage with "today's review" rather than "item 37 due now"). Under the hood each item is tracked individually, preserving pedagogical correctness with session-level UX intuition.

## **Review Queue Presentation**

The review queue is the set of items where `next_review_at <= now()` and `status = 'active'` for the profile. The UI surfaces due items as a continuous stream, sorted most-recently-missed first by default, with option to filter by original practice session or exam. There is no cap on the queue.

## **Tutor in Review**

Review is the pre-submission Socratic tutor surface. Before submitting, the student can invoke tutor. The tutor receives the question stem and options as context but **does not receive the correct answer or the explanation** — this is the architectural answer-withholding decision per CR-02B-29. Tutor guides reasoning through Socratic questioning without any capacity to leak the answer because it doesn't have it.

Tutor is question-aware (stem, options, passage context, student's in-progress reasoning if they've shared it) but structurally prevented from answer leakage.

## **Tutor-Assisted Correctness for SM-2**

At launch, tutor-assisted correctness counts the same as unaided correctness for SM-2 scheduling. If the student got it right, it counts as a successful retrieval regardless of whether tutor was used.

**The reasoning:** since tutor in review architecturally cannot know or leak the correct answer (per CR-02B-29), tutor-assisted correctness means the student figured it out with Socratic guidance. That's arguably better evidence of learning than unaided correctness because the student demonstrated they can reason through it with structured help. Treating them as equivalent is a hedge against overclaiming either way until launch data informs refinement.

The `used_tutor` flag is recorded per review attempt for telemetry and potential future algorithm refinement. This is a provisional rule (per CR-02B-16) — revisited with launch data.

UI guidance accompanies this behavior: the review surface tells the student that tutor help is valuable on early reviews (when still building understanding) but works against spaced repetition on later reviews (which measure memory retrieval). Students are nudged to attempt unaided on repeat reviews.

## **Review Completion**

A review session ends when the student has worked through their due items for the day or bails out. There is no forced completion. Items graduated today are removed from the queue; items answered correctly but not yet graduated update their scheduled next review; items answered incorrectly reset.

## **Calendar Integration Flag**

Review is the highest-leverage learning time per unit of student effort. The study calendar (future Doc 04\) must prioritize due review items above new practice when generating daily study plans. Flagged here as a requirement on Doc 04, not implemented here: the study plan generator allocates review time first, practice time second.

## **Why This Matters**

Spaced repetition is the strongest finding in the learning science literature. Students who practice without spaced review build fragile knowledge that collapses under exam pressure. Review is where Lyceon's learning outcomes actually happen.

## **Verification Before Refactor**

Before refactoring review behavior: verify whether `review_schedule` table has been created, inspect current review entry trigger (what happens when a practice or exam question is missed), inspect tutor-in-review integration (confirm tutor does NOT receive correct\_answer or explanation in context), test queue ordering and filtering, verify SM-2 field defaults if schema is in place.

---

# **17\. Full-Length Exam Engine**

## **Purpose**

Full-length exams are Lyceon's trust anchors. They simulate the real SAT as closely as possible — fixed forms with adaptive Module 2 routing, strict timing, server-authoritative clock, no tutor, no mid-exam reveals. Students take them periodically to measure progress, not as a daily activity. Exam results inform mastery heavily because high-integrity signal is scarce and valuable.

## **Canonical Writer**

`fullLengthExam.ts` is the canonical writer for full-length exam tables.

## **Form Model**

Exams are delivered as fixed official-style forms. A form defines the complete structure of a full-length exam matching real SAT structure:

* Module 1 for Reading & Writing (static for all students)  
* Module 1 for Math (static for all students)  
* Module 2 for Reading & Writing — two variants: weaker and stronger  
* Module 2 for Math — two variants: weaker and stronger

Each student taking the form sees both Module 1 sections and ONE of the two Module 2 variants per section, based on adaptive routing (§18).

Form blueprints live in `exam_forms` \+ `exam_form_items` (target write path) and currently also in `test_forms` \+ `test_form_items` (legacy read path). The migration to unify on `exam_forms` is incomplete per CR-02B-21.

Lyceon ships with 4 full-length forms at launch, matching Bluebook parity. Each form contains the full structured set (Module 1 \+ two Module 2 variants per section).

## **Sections and Timing**

Exams have two sections: Reading and Writing (RW) and Math (M). Both sections are timed per `exam_runtime_config.rw_section_duration_seconds` (directional: 3840 / 64 min at launch) and `exam_runtime_config.math_section_duration_seconds` (directional: 4200 / 70 min at launch).

Between sections, a break is enforced per `exam_runtime_config.break_duration_seconds` (directional: 600 / 10 min at launch).

## **Break Mechanics**

Between RW and Math sections, a break period begins:

* Break duration per `exam_runtime_config.break_duration_seconds`  
* Break timer does not count against either section's timer (break is free time)  
* Student may skip the break via an explicit "Continue to Math" action; skipping immediately ends the break and starts Math Module 1  
* If the student does not skip, the break ends automatically when the break timer expires and Math Module 1 auto-starts  
* During the break, the exam timer for sections is paused; no section questions are served

## **Server-Authoritative Continuous Timer**

The exam timer is strictly server-authoritative and strictly continuous. This is non-negotiable for integrity (INV-02B-10).

When an exam session is created, the server records `started_at` and computes section durations from `exam_runtime_config`. On every subsequent API call, remaining time is computed from server-side elapsed state. The client receives remaining time in responses but cannot influence it.

The timer runs regardless of client connectivity. Reconnect grace is per `exam_runtime_config.reconnect_grace_seconds` (0 at launch, per locked direction).

Multi-device reconnect is allowed — a student who starts on a laptop can switch to a phone mid-exam, because the timer is a server attribute not a device attribute. Concurrent-device access is controlled via session-active state: only one device at a time has the exam "active" (session-active state transfers on handshake; concurrent isn't allowed).

## **Auto-Submit on Expiry**

When a section timer reaches zero, the server automatically transitions that section to completed state with whatever answers have been submitted. Unanswered questions in that section are scored as omitted (incorrect per SAT rules).

When all sections complete (either by submission or auto-completion), the exam transitions to scoring. This produces a legitimate (possibly low) scaled score rather than an incomplete session.

## **Session Lifecycle**

Exam sessions progress through states: created (session record exists, not yet started), active-module-1 (student is working Module 1 of a section), active-module-2 (routed variant active), break (between sections), completed (all modules submitted or timer expired), abandoned (created but never started within timeout).

## **Starting an Exam**

The client requests exam session creation with a specific form identifier. The server validates authentication, validates premium entitlement (no exceptions), validates the form is published, validates no other active exam session, creates the `full_length_exam_sessions` row, creates the Module 1 rows in `full_length_exam_modules` (RW Module 1 and Math Module 1), and prefills the Module 1 questions from the form blueprint into `full_length_exam_questions` with position ordinals and denormalized snapshots.

Module 2 questions are NOT prefilled at session creation. They prefill after Module 1 routing (§18).

## **Serving Questions During Active Exam**

Questions are served from the prefilled `full_length_exam_questions` snapshots. Payloads contain stem, passage, options, assets, and remaining time. No correct\_answer, explanation, or option\_metadata per INV-02B-01. No module\_2\_variant label disclosed to client (the variant is server-only state per INV-02B-14).

During active exam:

* Answers can be changed within the current module until the module is submitted  
* Navigation between questions within a module is allowed (skip and return)  
* Navigation between modules is not allowed until current module is submitted  
* Once a module is submitted, it is locked and cannot be revisited

## **Exam Cancellation**

A student may cancel an in-progress exam. Cancellation marks the session abandoned; no scoring runs; no mastery events emit. The student may start a new attempt. This differs from real SAT (where submission is final) and is a reasonable practice-context allowance.

## **Completion and Review Gate**

An exam completes when all modules (RW Module 1, RW Module 2, Math Module 1, Math Module 2\) are submitted or the section timers have expired. On completion, the scoring pipeline runs immediately (§19). After scoring, review phase unlocks — the student sees correct answers, explanations, and full performance breakdown. Before completion, no reveals.

## **Why This Matters**

Exams are the single product feature that can be undermined by bad design most easily. Every exam integrity rule exists because violating it turns the exam from a measurement into a game. Positioning Lyceon's exams as strict-SAT-grade differentiates from competitors like Kaplan and Princeton Review (permissive) and matches Bluebook (official standard).

## **Verification Before Refactor**

Before refactoring exam engine: inspect `fullLengthExam.ts` for the read path (currently reads from `test_forms`, target is `exam_forms`), verify the adaptive routing is implemented server-side, confirm timer is truly server-authoritative, inspect module-locking enforcement, verify exam-eligible entitlement checks, test break-skip behavior and auto-start on break expiry.

---

# **18\. Full-Length Exam Adaptive Module 2 Routing**

## **Purpose**

Real SAT digital administration routes Module 2 based on Module 1 performance — students who performed well on Module 1 get the "harder" Module 2 variant; those who struggled get the "easier" variant. This adapts measurement precision to ability level. Lyceon implements the same pattern for SAT-authentic practice.

## **Routing Rule**

After a student submits Module 1 of a section (RW or Math), the server:

1. Computes the raw score for Module 1 (count of correct answers)  
2. Compares raw score against threshold in `full_length_adaptive_config` (`rw_m1_threshold_raw_score` for RW, `math_m1_threshold_raw_score` for Math)  
3. Selects the routed Module 2 variant per the routing rule  
4. Records the routing decision on the `full_length_exam_modules` row (module\_2\_variant, routing\_raw\_score, routing\_threshold\_used, routing\_config\_version, routed\_at)  
5. Prefills the Module 2 questions from the form blueprint into `full_length_exam_questions`  
6. Transitions the session to `active-module-2` state for that section

## **Threshold Rule and Tie-Break**

* Raw score strictly above threshold → route to harder variant  
* Raw score strictly below threshold → route to easier variant  
* Raw score exactly at threshold → route to easier (default; configurable via `full_length_adaptive_config.tie_break_rule`)

The "route easier on tie" default is a conservative choice: students at the exact threshold benefit from the easier variant's scoring curve; only those clearly above the threshold face the harder variant's ceiling.

## **Routing Authority and Tamper Resistance**

Routing is server-authoritative per INV-02B-14. The client does not receive and cannot influence the routing decision. The API response to the client does NOT include a `module_2_variant` field — the client receives the routed module's questions; nothing in the response discloses which variant was assigned. This prevents a sophisticated user from detecting their routing via network inspection.

The `module_2_variant` field is server-only state in `full_length_exam_modules`. It is visible only to admin/operations access and in post-exam diagnostic audit.

## **Routing Failure Handling**

If Module 1 scoring computation fails during routing (e.g., DB error, integrity check failure):

1. Retry the routing computation up to 3 times with exponential backoff  
2. On persistent failure, transition the exam to `exam_scoring_pending` state  
3. Alert operations immediately (high-severity page)  
4. Do NOT default to a variant — defaulting would either advantage or disadvantage the student  
5. Resolution is operational: fix the underlying issue, re-run routing, continue the exam

This prioritizes correctness over availability. A few-minute delay to route correctly is preferable to a mis-routed exam that produces an invalid scaled score.

## **Retired Questions in Module 1**

If a Module 1 question was retired between form publish and the student's exam, per INV-02B-13 the session\_item preserves the original snapshot. The question is served as normal. For routing, the student's answer against the snapshot's `correct_answer` is used — they get credit for correct answers based on what they were shown, not the current question state.

## **Routing Configuration**

Thresholds and parameters live in `full_length_adaptive_config`:

* `rw_m1_threshold_raw_score` — per-section raw score threshold for RW  
* `math_m1_threshold_raw_score` — per-section raw score threshold for Math  
* `tie_break_rule` — behavior at threshold (default: route\_easier)  
* `config_version` — version label for audit trail  
* `module_2_variant_labels` — canonical labels matching form structure

These are runtime constants per INV-02B-15. Changes to configuration affect future routings, not in-progress exams.

## **Audit Trail**

Every routing decision is reconstructable from the `full_length_exam_modules` row:

* `routing_raw_score` — Module 1 raw score at routing time  
* `routing_threshold_used` — the specific threshold value applied  
* `routing_config_version` — which config version was used  
* `routed_at` — timestamp of routing

This enables operations to investigate any routing anomaly after the fact.

## **Scoring with Module 2 Variants**

Module 2 variants have different difficulty curves. The scoring pipeline (§19) handles the variant-aware scaled score lookup. Scaled scores from the easier-variant path top out lower than scaled scores from the harder-variant path (this matches real SAT). Raw score \+ Module 2 variant determines scaled score.

Students who route to the easier Module 2 cannot earn the highest scaled scores; students who route to the harder Module 2 can. This matches real SAT behavior and is not a bug — it's the adaptive measurement working as designed.

## **Student Communication**

The UI does not tell the student which Module 2 variant they were routed to. Real SAT doesn't either. Upon review-phase unlock, the student sees their scaled score and breakdown but not the routing label. This preserves the adaptive measurement integrity and matches how Bluebook behaves.

## **Why This Matters**

Without adaptive Module 2, Lyceon's full-length exams don't match real SAT behavior. Students who practice on non-adaptive forms experience a different test than what they'll encounter on test day. The authenticity gap undermines the trust-anchor positioning. Adaptive Module 2 is what makes these exams SAT-grade measurement, not just "practice tests with timing."

## **Verification Before Refactor**

Before refactoring adaptive routing: inspect `full_length_adaptive_config` for current thresholds and structure, verify routing logic in `fullLengthExam.ts` is server-side (not client-influenced), confirm Module 2 prefill happens after Module 1 submission (not at session creation), test that both variants exist in form blueprints and are labeled consistently, verify API response does NOT include variant label, test retired-question handling in Module 1 scoring.

---

# **19\. Exam Scoring Pipeline**

## **Purpose**

The scoring pipeline converts a completed exam session into a scaled score, section scores, and diagnostic breakdown. The pipeline is deterministic — the same submitted answers produce the same scores every time.

## **Scoring Inputs**

Per-question answer correctness from `full_length_exam_responses`, section membership, Module 2 variant per section from `full_length_exam_modules`, domain and skill metadata from session\_item snapshots.

## **Raw Scoring**

Raw section score equals count of correct answers across both Module 1 and the routed Module 2 variant for that section. Omitted questions count as incorrect per SAT scoring rules.

## **Full Section Omission**

If a student omits an entire section (timer expired with zero answers submitted or section submitted with zero answers), scaled score for that section is the minimum (200 per College Board methodology). Total scaled score is computed from both sections normally. Scoring pipeline handles zero-raw-score cases without error.

## **Scaled Scoring**

Scaled scores convert raw scores to SAT scale (200-800 per section, 400-1600 total) using official SAT conversion tables stored in `sat_score_tables` (naming subject to verification). Each (section, module\_2\_variant, raw\_score) combination maps to a scaled score — the variant affects the curve.

Scaled scores are disclosed to students with language: "Scaled using official SAT scoring methodology. Minor variation may occur between real SAT administrations."

## **Domain-Level Breakdown**

The pipeline computes per-domain correct count, total count, and accuracy percentage. Domain accuracy is shown to students as diagnostic information. Domain-level scaled contribution is NOT computed as an official score — scaled scores exist only at section and total level.

## **Skill-Level Diagnostic**

The pipeline computes skill-level accuracy per skill\_code. Skills with insufficient sample size (directional: fewer than 3 questions) are omitted or flagged as low-confidence.

Skill-level outputs are explicitly labeled as "learning diagnostic" or "learning signal," not as official scores. The UI and API responses must not conflate weighted skill signals with official SAT scores.

## **Score Rollup Persistence**

Scoring results persist to `full_length_exam_score_rollups`:

* Link to `full_length_exam_sessions`  
* Per-section raw scores  
* Per-section scaled scores  
* Total scaled score  
* Domain-level breakdown (jsonb)  
* Skill-level diagnostic (jsonb)  
* Scored\_at timestamp

## **User-Facing Disclosure**

When the student sees their exam results: raw scores per section, scaled scores per section and total (labeled as official-methodology scaled), domain-level accuracy (labeled as diagnostic), skill-level diagnostic (labeled as learning signal). Clear separation between official-methodology numbers and diagnostic numbers.

Prohibited language: "guaranteed score," "predicted SAT score" (implying a number matching real SAT), "your SAT score is X." Approved: "scaled using official SAT methodology," "diagnostic signal," "estimated range."

## **Mastery and Plan Integration**

Exam results trigger mastery updates via the RPC per §25. Per PDF-05's truth-anchor principle, exam-based mastery deltas are weighted higher than practice deltas. The specific weights live in `mastery_constants` and are governed by Doc 02C.

For the period following an exam (directional: 7 days), practice and review prioritization emphasizes skills the student struggled with on the exam. Calendar integration flag per §16.

## **Scoring Idempotency**

Scoring runs once per exam completion. Re-running produces identical results and does not duplicate mastery events. Score rollups are persisted; re-running reads cached results.

## **Why This Matters**

The scoring pipeline is the most visible runtime output after an exam. A student who takes a practice exam and sees "1340 scaled score" believes that number means something. Strict separation between official-methodology scaled scores and diagnostic learning signals exists to maintain honest student expectations.

## **Verification Before Refactor**

Before refactoring scoring: inspect current `sat_score_tables` (or equivalent) for Module 2 variant awareness, verify scoring is deterministic (re-run produces same result), confirm scoring triggers mastery RPC calls, inspect UI labeling of scaled vs diagnostic signals, verify domain and skill breakdown storage matches downstream consumption expectations, test zero-raw-score edge case.

---

# **20\. Reveal Matrix and Enforcement**

## **Authoritative Source**

The reveal matrix is governed by Preamble V3 §12. This document is the enforcement arm at runtime.

## **Absolute Prohibition**

Pre-submit client-facing surfaces must never contain correct answers, explanations, internal option metadata, or distractor taxonomy labels. This rule is absolute. No feature flag, environment setting, debug mode, or runtime toggle may override it. Any violation is a critical defect (INV-02B-01, enforcing INV-02-08 and INV-02-09).

## **Per-Endpoint Enforcement**

Every runtime endpoint that serves question content constructs response payloads complying with the reveal matrix. The server constructs payloads correctly; no client parameter alters what the server sends.

* **Practice next-question:** stem, passage, options (keys \+ text), assets, position ordinal. No correct\_answer, explanation, option\_metadata.  
* **Practice answer-submission response:** correctness outcome, correct answer key, explanation text. No option\_metadata.  
* **Exam active-session question:** stem, passage, options, assets, remaining time. No correct\_answer, explanation, option\_metadata. No indication of Module 2 variant.  
* **Exam review-phase (after completion):** full reveals — correct answers, explanations, per-question correctness, diagnostic breakdowns. No option\_metadata.  
* **Review pre-submission question:** stem, passage, options, assets. No correct\_answer, explanation, option\_metadata.  
* **Review post-submission response:** correctness, correct answer key, explanation. No option\_metadata.  
* **Tutor (practice post-submit):** may reference canonical explanation and elaborate.  
* **Tutor (review pre-submit):** receives question context and options but does NOT receive correct\_answer or explanation. Cannot leak what it doesn't have.  
* **Tutor (active exam):** absent from UI; server invocation returns warning-nudge; content not provided.  
* **Tutor (exam review phase):** may elaborate on explanations (same as practice post-submit).  
* **Guardian analytics:** aggregate only. No question-level content, correct answers, student answers, or internal metadata.  
* **Internal analytics:** service-role or admin only; may include internal metadata for operations; mutually exclusive from student and guardian surfaces.

## **Server-Side Enforcement**

All reveal rules enforced server-side. Server constructs payloads per the matrix; no client path alters what server sends. Client-side reveal logic exists only for post-submit rendering of already-sent canonical content. No client-side "should we show the answer" decision because the server has already decided by what it sent.

Critical because client-side reveal decisions are bypassable by adversarial users; server-side decisions are not.

## **Why This Matters**

Academic integrity depends on this. A leaked answer on practice undermines practice; a leaked answer during exam destroys the exam. The reveal matrix is the single most important cross-cutting rule in the runtime.

## **Verification Before Refactor**

Before refactoring any question-serving endpoint: inspect current response payloads for pre-submit content, trace each field to construction site (explicit inclusion, no implicit leakage), verify no feature flag or debug mode produces reveal violation, test tutor responses in review context to confirm no correct\_answer or explanation in context, audit the tutor-in-review prompt construction to verify answer-withholding.

---

# **21\. Tutor Runtime Rules**

## **Surface-Aware Behavior**

Tutor behavior varies by runtime surface. The tutor endpoint receives context describing surface and behaves accordingly.

**In practice (post-submit):** Tutor is available only after submission. Student sees their result, canonical explanation, and can invoke tutor for deeper reasoning. Tutor receives question content, correct answer, explanation, and student's answer as context.

**In review (pre-submit):** Tutor is available before submission. Student reasons with tutor support. Tutor receives question stem, passage, options, and student's in-progress reasoning — but **NOT the correct answer or explanation**. This architectural answer-withholding (per CR-02B-29) prevents leakage regardless of prompt behavior. Tutor guides by Socratic questioning without having the answer to leak.

**In active full-length exam:** Tutor absent from UI. Server-side invocation returns warning-nudge response with timer remaining and active-exam acknowledgment; telemetry-logged for audit. Not hard-blocked because students with abandoned-but-active exam sessions may legitimately need tutor for unrelated study.

**In exam review phase (after completion):** Tutor behaves like practice post-submit — available with full context (question, answer, explanation, student's answer).

## **Entitlement**

Tutor is premium-only across all surfaces. Free users never invoke tutor. Server validates premium entitlement before any tutor interaction.

## **Tutor Invocation Contract**

The tutor invocation endpoint takes:

* Session identifier and session\_item identifier  
* Surface context (practice-post-submit, review-pre-submit, exam-review)  
* User's current message or prompt  
* Conversation history identifier (if continuing)

The response includes:

* Tutor response text  
* Turn metadata (conversation\_id, turn\_number)  
* Optional UI affordances (hint buttons, clarification prompts)  
* Rate-limit headers if approaching limit

Zod schemas at the API boundary validate request and response shapes.

## **Question Awareness**

Tutor is question-aware — the tutor endpoint receives question content as context appropriately per surface. The context differs by surface:

| Surface | Question stem/options | Correct answer | Explanation | Student answer |
| ----- | ----- | ----- | ----- | ----- |
| Practice (post-submit) | Yes | Yes | Yes | Yes |
| Review (pre-submit) | Yes | **No** | **No** | In-progress reasoning only |
| Active exam | N/A (not provided) | N/A | N/A | N/A |
| Exam review | Yes | Yes | Yes | Yes |

## **Rate Limiting and Cost Management**

Tutor is Lyceon's highest variable-cost feature. Runtime enforces per-profile rate limits:

* `tutor_runtime_config.rate_limit_per_profile_per_hour` — hourly cap (directional value pending product decision)  
* `tutor_runtime_config.rate_limit_per_profile_per_day` — daily cap

When a premium user hits the rate limit mid-session:

* Response includes `rate_limited: true` with retry-after countdown  
* Client displays throttle message with countdown; tutor panel remains visible but non-interactive  
* Session state is unaffected — student can continue the practice or review item without tutor, submit, and proceed

Rate limits are generous for normal use; only heavy users encounter throttling. Limits live in `tutor_runtime_config` and are tunable operationally.

## **Resume Behavior for Tutor Conversations**

If a premium user has an active tutor conversation in a review session and disconnects, then returns:

* **At launch:** Tutor conversation discarded. Student starts fresh tutor interaction if desired. Simpler.  
* **Target state:** Conversation history visible but no active turn. Student may continue or abandon.

## **Tutor and Mastery**

Tutor interactions are logged but do not emit mastery-bearing events. This is INV-02B-11, a deliberate simplification.

Tutor usage is recorded for telemetry and potential future refinement (e.g., future mastery math may factor tutor usage differently). The data is captured; the math doesn't use it yet.

## **Tutor Interaction Telemetry**

Every tutor invocation records surface, session\_id, question\_id, profile\_id, timestamps, tutor model version, and any post-interaction signal. Tutor prompt and response content are not logged (privacy and content-scraping concerns).

## **Why This Matters**

Tutor is Lyceon's highest variable-cost feature (Gemini API) and highest differentiator. Surface-aware behavior is what makes each surface work. The architectural answer-withholding in review is the critical integrity guarantee: guided reasoning requires tutor can't cheat. Rate limiting keeps costs predictable while not meaningfully constraining normal premium usage.

## **Verification Before Refactor**

Before refactoring tutor runtime: inspect `tutor-runtime.ts` for surface-awareness in context construction, verify review-mode tutor context excludes correct\_answer and explanation at the API call level (not just via prompt), test exam-context warning-nudge response, confirm tutor entitlement enforcement server-side, inspect tutor interaction telemetry for completeness, test rate-limit enforcement and mid-session throttling behavior.

---

# **22\. Session State and Resume Rules**

## **Practice Session Resume**

Practice sessions are resumable. If a student closes the browser or loses connectivity during an active session, they return and resume. The system offers resume-or-new-session choice.

Resume uses server-authoritative state. On next-question request, server returns the next pending session\_item rather than advancing or re-selecting.

Inactivity timeout transitions active sessions to abandoned after `practice_runtime_config.inactivity_timeout_hours`. Abandoned sessions not resumable.

## **Review Session Resume**

Review is queue-based. No "resume" per se; student returns, sees current due items. In-progress tutor interactions (attempted but not submitted) are abandoned at launch (per §21); item remains in queue for fresh attempt.

## **Full-Length Exam Resume**

Exam resume strictly constrained by original time window. Timer is server-authoritative and continuous; runs whether student connected or not. Zero grace period.

Reconnect while time remains: returns to section state, timer shows correct remaining time (has continued running).

Reconnect after timer expired: exam already auto-completed from server's perspective; student sees completed exam with whatever answers existed before disconnect, scored against full exam.

Multi-device reconnect allowed but concurrent not — only one device has session-active state at a time.

## **Concurrent Submission Resolution by Surface**

Concurrent submissions from multi-tab or multi-device scenarios resolve differently by surface to match each surface's integrity needs:

* **Practice:** Latest valid submission before answer lock wins. Prior attempts retained for audit if needed (idempotency\_key uniqueness prevents actual duplicate rows; different attempt keys treated as sequential).  
* **Review:** First finalized submission wins for the attempt instance. Subsequent submissions for the same review attempt are rejected as already-answered.  
* **Exam:** Latest answer within an active module before module submit wins. Students can change answers within a module freely. After module submission, hard lock — no further answer changes.

## **Why This Matters**

Resume behavior is user-visible. Lost 30-minute practice session to browser crash \= user probably doesn't return. Exam "grace period" \= exam isn't real. Forgiving for practice, strict for exams \= each surface feels right. Concurrent resolution differences match each surface's integrity needs.

## **Verification Before Refactor**

Before refactoring resume: test practice resume for duplicate-item prevention against `practice_session_items` prefill, verify exam timer is truly server-authoritative (cannot be influenced by client state), test multi-device reconnect for exam, confirm abandoned-session transition policy, test concurrent submission behavior per surface.

---

# **23\. Answer Submission Contract**

## **Structural Contract**

Every answer submission is authenticated, bound to an active session item, idempotent via client\_attempt\_id, timestamped, validated, persisted once.

## **Authentication and Ownership**

Server validates submitting user owns the session via profile\_id join. Cross-user submissions impossible at server boundary.

## **Idempotency**

Clients provide client\_attempt\_id with every submission. Same client\_attempt\_id submitted before: return prior result without writing duplicate. Idempotency scope is per session\_item (UNIQUE on user\_id \+ client\_attempt\_id at DB level).

## **Validation**

Before persisting: session active, session\_item not already answered, submitted answer key is one of valid options, submission not after section expiry (exam).

Invalid submissions return descriptive error responses. No partial writes.

## **Evaluation and Persistence**

For valid submissions: fetch canonical answer from session\_item snapshot (not from live questions table — immutability), evaluate correctness by comparing selected to snapshot's correct\_answer, persist outcome onto session\_item row (selected\_answer, is\_correct, outcome, time\_spent\_ms, answered\_at, status), trigger mastery RPC per §25.

## **Why This Matters**

Answer submission is the highest-frequency write operation. Tens of times per student per day, millions per month at scale. Idempotency and correct state tracking are the difference between clean data and corrupted data.

## **Verification Before Refactor**

Before refactoring submission: inspect current submission endpoints, verify idempotency implementation (test duplicate client\_attempt\_ids), confirm validation order, inspect mastery RPC trigger timing and error handling.

---

# **24\. Reaction Policy Layer**

## **Purpose**

The reaction policy layer governs what happens after specific runtime events — what instructional variant is shown after a wrong answer, what hint depth is used when a student requests help, what recovery path follows a repeated failure. The mechanism makes the runtime adaptive beyond just question selection.

In scope for 02B because it is runtime behavior with implications for world-model training data.

## **Launch vs Target State**

At launch:

* Policy family taxonomy exists in DB  
* Runtime uses default variant for each family (no Fisher-Yates selection)  
* Assignment and exposure tables populated with the default variant  
* Data captured for future policy decisions without introducing randomization

At target state:

* Full reaction policy with Fisher-Yates selection across multiple variants  
* Launch data informs which variants to test and how

This phased approach captures the data infrastructure at launch while deferring the experimentation mechanism until the data supports informed variant choices.

## **Policy Families**

Policy families are categories of instructional decisions the runtime varies:

**Explanation style** — whether post-submit explanation is concise, detailed, Socratic, simplified, or trap-first. Used in practice/review post-submit.

**Hint depth** — when student requests help during review pre-submit (via tutor), whether first hint is nudge, one-step scaffold, process reminder, or multi-step walkthrough.

**Recovery path** — after missed practice question, whether student is offered immediate retry, review-queue flag, or tutor prompt.

**Session framing** — how session opener frames upcoming work (focus reminder, confidence prompt, strategy framing, neutral).

**Pacing response** — how system responds to fatigue signals (reduce difficulty, insert review block, pause prompt, redirect to strategy).

Each family has bounded allowed variants. New variants require versioned policy update.

## **Deterministic Variant Selection (Target State)**

When runtime picks a variant within a family at target state, it uses Fisher-Yates selection seeded by stable hash of `profile_id + question_id_or_skill + policy_family + policy_version + session_epoch`.

Seeded hash produces consistent selection for same inputs (reproducible and auditable), variety across sessions (different session\_epoch) and students (different profile\_id).

At launch, the "selection" is deterministically the default variant — the code path is in place but randomization is off.

## **Policy Assignment Recording**

Every policy decision recorded to `tutor_instruction_assignments` (current table) or equivalent target-state policy-assignments table. Fields: profile, session, session\_item (if applicable), skill, policy family, chosen variant, policy version, prompt version (if applicable), assignment mode, eligibility snapshot, assignment timestamp.

Assignments are immutable (INV-02B-12). Corrections via new records, not mutation.

## **Exposure Recording**

Assignment vs exposure recorded separately. Exposures land in `tutor_instruction_exposures` (current) or equivalent. Assignment is "decision made"; exposure is "student actually saw it." The distinction matters for analysis.

## **Forbidden Experimentation Zones**

Some behaviors absolutely outside reaction policy experimentation (from PDF-WM §5):

* Mastery math never randomized. Event weights, alpha, scoring math fixed.  
* Canonical answer checking never altered. Correctness is correctness.  
* Reveal policy never varied. Reveal matrix absolute.  
* Tutor conversations never directly emit mastery.  
* Second hidden progress ledgers never created. One canonical mastery layer.  
* Guardian access and entitlement never varied as policy decisions.

These prohibitions preserve data quality. Policy layer mutating these creates attribution chaos.

## **Self-Report Signals**

Runtime optionally captures sparse self-report signals: confidence rating before/after selected item, focus self-report, fatigue indicator. Captured sparingly to avoid survey fatigue. Recorded per-interaction.

## **Why This Matters**

Without policy layer, runtime behaves same for every student regardless of state. A year from now, when Lyceon wants to analyze which recovery paths work for which student states, data must support analysis. The discipline encoded here makes data trustworthy as input to future world-model training. Launch-phase scope ensures we capture the data infrastructure without committing to experimentation mechanisms before they're needed.

## **Verification Before Refactor**

Before implementing or refactoring reaction policy: verify current policy assignment and exposure tables exist and are being written, map existing policy decisions in runtime to family taxonomy, confirm current instructional variants are deterministic and replayable, identify ad-hoc runtime variants needing to come into policy framework.

---

# **25\. Runtime Event Flow and Mastery RPC**

## **Purpose**

The runtime writes canonical finalized outcomes to session\_items, attempts, and rollup tables. It then triggers mastery updates by calling the `apply_learning_event_to_mastery` RPC. The boundary between 02B and 02C is exactly this call.

## **Canonical Outcome Writes**

Runtime writes go to session\_items and attempts tables per the canonical writer map:

* Practice answer submitted → write to `practice_session_items` (finalized outcome columns)  
* Review attempt → write to `review_error_attempts` linked to `review_session_items`, update `review_schedule` SM-2 state (target)  
* Exam answer → write to `full_length_exam_responses`  
* Exam completion → write to `full_length_exam_score_rollups`

These writes are the canonical runtime truth. They capture what happened per student per interaction.

## **Mastery RPC Interface Contract**

After writing the canonical outcome, the runtime calls `apply_learning_event_to_mastery` (via `mastery-write.ts`) with the event payload. The payload shape is:

{  
  event\_id: uuid,  
  event\_type: enum (practice\_correct | practice\_incorrect | review\_correct | review\_incorrect | test\_correct | test\_incorrect),  
  version: int,  
  profile\_id: uuid,  
  question\_id: text (canonical question ID),  
  session\_id: uuid,  
  session\_item\_id: uuid,  
  occurred\_at: timestamptz,  
  payload: {  
    difficulty: int,  
    section: text,  
    domain: text,  
    skill\_codes: text\[\],  
    selected\_answer: text,  
    is\_correct: bool,  
    used\_tutor: bool  
  }  
}

The `version` field enables schema evolution — when the contract changes, new events adopt a new version; old events remain readable under their version.

The RPC response confirms mastery update and returns the updated mastery snapshot (or error on failure).

Algorithm details are governed by Doc 02C. 02B's responsibility is: emit event with correct payload → receive confirmation or error → continue runtime flow.

## **Failure Handling**

RPC failures are retried with exponential backoff. The session outcome is already persisted to session\_items before the RPC call, so mastery is eventually consistent. Persistent RPC failures alert operations without blocking the user's runtime experience.

## **Why Runtime Does Not Compute Mastery**

The mastery algorithm belongs in one place — currently the SECURITY DEFINER Postgres function. Runtime that recomputes mastery would create drift risk. The RPC pattern ensures:

* Single canonical algorithm (no parallel implementations)  
* Atomic multi-tier write (domain \+ skill \+ cluster updated together)  
* RLS bypass for authoritative write (runtime can't write mastery tables directly)  
* Audit trail (every mastery change is an RPC invocation, identifiable in logs)

## **Event Contract for Downstream**

The session\_items writes and RPC invocations together are the event record. Downstream systems that need learning events read the mastery tables and the source session\_items/attempts tables. The legacy `practice_events` and `review_session_events` tables attempted a separate event stream but are being phased out per CR-02B-28. Canonical pattern: session\_items as runtime state \+ RPC call as mastery trigger.

## **Why This Matters**

The RPC pattern is Lyceon's cleanest architectural boundary. 02B runtime doesn't care how mastery is computed; 02C mastery engine doesn't care how events were captured. Each side has a single responsibility and a clean interface. This is the model other cross-concern boundaries in the system should emulate.

## **Verification Before Refactor**

Before refactoring mastery event emission: inspect `mastery-write.ts` for RPC call signature, verify event payload structure matches the versioned contract, confirm no runtime code writes directly to mastery tables, test that RPC failures are handled appropriately (retry with alert on persistent failure).

---

# **26\. Canonical Runtime Layer and Analytics Export**

## **Layer 1: Canonical Runtime State**

The canonical runtime layer is the existing session\_items, attempts, response, and rollup tables. These tables capture finalized runtime state — what happened per student per interaction, in denormalized form optimized for runtime queries and protected by RLS.

Runtime writes to these tables synchronously. No events are sampled or downsampled. Every finalized outcome is recorded.

## **Sharper Wording: Session Items as State, Not Events**

Session items are the canonical runtime **state record**. They are not event streams in the pub/sub sense. An event is something that happened at a point in time; a session\_item is a stateful record of an interaction's final outcome.

Derived events and analytics exports may still be reconstructed or materialized from state transitions and supporting interaction logs (policy assignments, exposures, tutor invocations, self-reports). Future analytics needs multiple temporal facts per interaction (served\_at, viewed\_at, answer\_submitted\_at, explanation\_opened\_at, tutor\_invoked\_at) — these can be reconstructed from state transitions plus supporting logs without reviving bloated event tables prematurely.

## **Layer 2: Analytics Export**

Downstream of the canonical runtime state, Doc 02C governs analytics export — the scheduled derivation of student timelines from runtime tables for long-term analytics, world-model training, and offline causal analysis.

02B's responsibility ends at the canonical state. 02B does not own analytics export implementation, export schema, pseudonymization, or destination. 02B's contract is: write canonical state correctly, keep it append-only, preserve immutability of finalized records.

## **Append-Only Discipline**

Canonical runtime writes are append-only in the sense that finalized outcomes are not modified after write. If logic changes, new records adopt new schema; old records not retrofitted. Preserves historical record.

Exception: mastery\_snapshot fields on session\_items may update as mastery state evolves post-event (for audit replay). The finalized outcome columns (selected\_answer, is\_correct, outcome, answered\_at) are immutable.

## **Privacy Posture**

Runtime tables use real profile\_id for RLS-based access control. Any downstream export pseudonymization is 02C scope.

## **Why This Matters**

A runtime that cannot export its event stream cleanly cannot train world models. The discipline around ordering, versioning, and append-only append is what bridges current runtime to future adaptive system. Keeping 02B responsible only for the canonical state keeps the boundary clean.

## **Verification Before Refactor**

Before refactoring telemetry architecture: inspect canonical table writes for append-only discipline (no destructive updates to finalized columns), verify policy and exposure tables carry versioning attribution, confirm no separate event-stream tables are being added (per phase-out of `practice_events` and `review_session_events`).

---

# **27\. Rendering Standards**

## **Question Rendering**

Question rendering must support clean text layout, math notation rendering (LaTeX via MathJax or KaTeX), passage formatting for R\&W items with paragraph structure preserved, image and diagram rendering with alt text, responsive mobile and desktop layouts, low-latency transitions between questions, safe fallback states for failed asset loads.

## **Shell Consistency**

The runtime shell — navigation, progress indicators, tools panel, submit controls — is visually consistent across Math and R\&W questions. Context-specific tools (calculator, formula sheet on Math) appear in the same UI location, enabled or disabled based on question context.

## **Graceful Degradation**

UI failures degrade gracefully. Failed image load shows alt-text fallback. Failed tutor response shows retry option. Slow question fetch shows loading indicator.

## **Mobile and Desktop Parity (Future)**

Web launch target; mobile post-launch. Rendering system designed to accommodate mobile from start.

## **Why This Matters**

Rendering is where runtime becomes visible. Trust formed largely by rendering quality — does math look right, do passages read naturally, does interface respond quickly.

## **Verification Before Refactor**

Inspect current math rendering library coverage, test passage formatting against representative R\&W questions, verify asset load fallbacks, test responsive behavior at various viewports.

---

# **28\. Math Tooling: Desmos and Formula Sheet**

## **Desmos Integration**

Desmos is the SAT-native graphing calculator. Lyceon has integrated the Desmos API and exposes it across runtime surfaces (practice, review, full-length).

The Desmos panel is a collapsible UI element. On Math questions, enabled and available (collapsed by default, expandable). On R\&W questions, disabled or hidden. Shell structure identical across sections — only tool's enabled state differs — so students don't experience jarring layout shifts.

State within session persists: open Desmos on one question, remains opened on advance.

## **Formula Sheet**

Lyceon reproduces the formulas (formulas themselves are not copyrightable) and presents in visually familiar format without pixel-copying College Board's specific PDF layout. Collapsible panel, enabled on Math, disabled on R\&W, state persists.

## **Availability Across Surfaces**

Both tools available in practice, review, full-length exams for Math questions. UI consistency across surfaces.

## **Free and Premium Tiers**

Both tools available to free and premium users. Not premium gates. Denying free users basic SAT tools would make practice pedagogically broken; marginal cost of including them is zero.

## **Why This Matters**

Desmos is the official SAT calculator (Bluebook). Formula sheet is part of real SAT. Practicing without these is practicing for a different test. Table stakes, not features.

## **Verification Before Refactor**

Verify current Desmos integration uses official API, inspect formula sheet content for accuracy, test tool availability across all three runtime surfaces on Math questions, confirm UI consistency between Math and R\&W.

---

# **29\. Failure Modes**

| Failure | Expected Response |
| ----- | ----- |
| Auth token expired mid-session | Return 401; client re-authenticates; session state preserved |
| Entitlement lapses mid-session (Stripe webhook arrives) | Current question completes; next gated with CTA; session preserved |
| Session already completed on submit | Return 409; client reconciles to completed state |
| Idempotency collision (same key, different content) | Treat as original; return prior result; log |
| Concurrent submissions practice | Latest valid before answer lock wins; prior attempts retained in history |
| Concurrent submissions review | First finalized wins; subsequent rejected as already-answered |
| Concurrent submissions exam (pre-module-submit) | Latest answer wins; module lock unaffected |
| Question retired between snapshot and submit | Accept against snapshot's correct\_answer (snapshot immutability INV-02B-13) |
| Clock skew on client | Server time authoritative; client display reconciles |
| Scoring pipeline failure on exam completion | Retry; if persistent, mark exam completed-pending-score; alert; don't block return |
| Question fetch fails | Retry with backoff; fallback message after repeated failure; session preserved |
| Render asset fails | Display alt text; question remains answerable; flag for content review |
| Double submit | Idempotency handles single record |
| Browser close during practice | Session marked resumable; no penalty |
| Browser close during exam | Timer continues; resume if within window or see auto-completed |
| Network drop during exam | Timer continues; reconnect re-establishes or finds auto-completed |
| Quota hit at session start (pre-cap) | Session target adjusted to remaining quota; CTA visible |
| Zero quota at session start | Session creation refused; quota-exhausted response with countdown |
| Tutor timeout | Session state unaffected; retry option |
| Tutor rate limit hit mid-session | Response includes rate\_limited flag and countdown; client shows throttle message; session continues without tutor |
| Multi-device concurrent exam access | Previous device session-active state released; latest connection owns |
| Invalid answer key in submission | Return 400; session unchanged (UI should prevent) |
| Module lock violation (submit to closed module) | Return 409; prior module submission final |
| Module 2 routing: raw score exactly at threshold | Per `full_length_adaptive_config.tie_break_rule` — route easier at launch |
| Module 2 routing: computation failure | Retry up to 3 times with exponential backoff; persistent failure → exam\_scoring\_pending state \+ ops alert; no default variant |
| Mastery RPC failure | Retry with exponential backoff; alert on persistent failure; session outcome already persisted to session\_items (mastery eventually consistent) |
| Prefill selection failure (no eligible questions) | Return error to client; do not create session with fewer than target items without user consent |
| Review schedule write failure | Log error; attempt write doesn't affect user-visible correctness; review item may need manual reschedule later |
| `practice_events` or `review_session_events` write failure | Non-blocking (legacy tables phasing out); log error; session continues normally |
| Full section omission in exam | Scaled score \= 200 (minimum); total scaled computed normally |
| Exam break timer expires without interaction | Next section auto-starts; student returns to active section |
| Student skips break | Break ends immediately; next section starts |

## **Why This Matters**

Failure mode documentation is operational contract. Production incidents need reference for expected behavior. Without it, every failure becomes from-scratch decision producing inconsistent outcomes.

---

# **30\. Pipeline Observability**

## **Structured Logging**

Every runtime action emits structured logs (JSON) per Coding Standards §12. Required fields: request identifier, profile\_id (if authenticated), session\_id (if in session), action type, duration\_ms, success/failure flag, error context if failed.

Logs redacted per Coding Standards §12.1. Never logged: cookies, auth headers, tokens, student answers, tutor prompts, tutor responses, internal option metadata.

## **Required Metrics**

* **Availability:** session creation success, question fetch success, answer submission success  
* **Latency:** P50/P95/P99 for question serve, answer submit, exam scoring, tutor response, mastery RPC  
* **Throughput:** sessions/hour, questions/hour, answers/hour by surface  
* **Engagement:** session completion, abandonment, avg questions/session  
* **Freemium funnel:** quota exhaustion rate per free profile, CTA impression, upgrade conversion  
* **Exam integrity:** exam completion rate, auto-submit-on-expiry rate, reconnect rate, routing decision distribution (easier vs harder Module 2\)  
* **Tutor usage:** invocations per session (premium), cost per session, rate-limit hit rate  
* **Error rates:** 4xx and 5xx per endpoint

## **Alert Thresholds**

* Session creation success \<95% over 5min (possible outage)  
* Answer submission failure \>1% over 5min (data integrity risk)  
* Exam scoring pipeline failures (immediate page)  
* Quota check failures (quota broken, could allow unlimited free practice)  
* Mastery RPC failure rate \>1% (mastery drift risk)  
* Module 2 routing: extreme distribution skew (e.g., 99% routing to easier) suggests Module 1 difficulty miscalibration  
* Module 2 routing computation failures (immediate page)  
* Tutor response failure rate above threshold

## **Why This Matters**

A runtime without observability degrades silently. Observability converts silent failures to actionable signals.

## **Verification Before Refactor**

Inspect current logging library and redaction, audit logs for inadvertent PII or sensitive content leakage, verify metrics coverage, test alert firing against known-bad scenarios.

---

# **31\. CI / Testing Standards**

## **Required Test Coverage**

* Zod schema tests at every API boundary  
* Reveal matrix tests: every question-serving endpoint confirms pre-submit responses exclude correct\_answer, explanation, option\_metadata  
* Entitlement gate tests: every premium-gated endpoint confirms free user gets correct error response  
* Quota tests: free user simulation confirms pre-cap at session creation, reset behavior, CTA triggering, zero-quota refusal  
* Idempotency tests: submit same client\_attempt\_id twice, verify single attempt recorded  
* Resume tests: simulate disconnect/reconnect for practice and review, verify no duplicates and correct state  
* Exam timer tests: simulate disconnect scenarios, verify timer continuity and auto-submit-on-expiry  
* Exam break tests: verify skip behavior, auto-start on expiry, section timer independence  
* Module 2 routing tests: test both easier and harder routing paths, edge case at threshold, computation failure handling, no-variant-leakage in API responses  
* Scoring pipeline tests: known answer sets produce known scaled scores deterministically, including Module 2 variant awareness and full-section omission  
* Selection logic tests: replay same inputs, verify consistent selection  
* Mastery RPC integration tests: verify RPC call on each event type, verify no direct mastery table writes, verify versioned payload contract  
* Snapshot immutability tests: retire underlying question, verify session\_item snapshot unchanged  
* **Constants-in-DB enforcement (INV-02B-15):** Static analysis or test suite that fails if runtime code contains numeric literals affecting user-visible behavior (quota sizes, intervals, durations, thresholds). List of allowed exceptions (zeros, ones for collection indices, small integer constants for UX calculations). This enforces the constants doctrine at CI level.

## **Coverage Thresholds**

* ≥95% on reveal-matrix enforcement code (anti-leak; must be tested)  
* ≥90% on entitlement gate code  
* ≥90% on scoring pipeline code including Module 2 routing  
* ≥85% on selection logic  
* ≥85% on mastery RPC invocation paths  
* ≥80% overall runtime code

Coverage failures block merge. PR CI must pass before merge regardless of reviewer approval.

## **Integration Tests**

Run against test Supabase project, not production. Scenarios: complete practice session end-to-end, complete review attempt with SM-2 schedule update, complete full-length exam including Module 2 routing and scoring, verify reveal matrix at each endpoint, verify mastery RPC call completeness.

## **Regression Tests**

Known-good scenarios committed. Examples: specific free user journey through quota exhaustion, specific exam form scoring producing specific scaled score, specific review item SM-2 trajectory through 5 correct retrievals to graduation.

## **Why This Matters**

Tests on reveal-matrix and mastery-RPC paths matter most. Schema validation bug passes tests becomes production bug with incorrect behavior. Reveal-matrix bug passes tests becomes security incident violating academic integrity. The constants-in-DB enforcement test is the enforcement mechanism for INV-02B-15 — without it, the doctrine is aspirational.

## **Verification Before Refactor**

Verify current CI pipeline existence and coverage, identify critical code paths with inadequate coverage, add tests for anti-leak or entitlement paths lacking coverage before functional changes.

---

# **32\. Security and Integrity Controls**

## **Authentication**

All runtime endpoints require authentication. Session tokens validated server-side against Supabase Auth. Expired tokens receive 401\.

## **Authorization**

Every action authorized against acting profile identity and target resource. Student accesses only their own sessions, attempts, scheduling. Cross-profile access impossible at server boundary.

## **Entitlement**

Entitlement checked server-side on every gated action (INV-02B-03). Client claims never trusted.

## **Rate Limiting**

Runtime endpoints have rate limits. Question serves: high throughput, not rate limited except abuse. Tutor invocations: lower throughput, rate-limited for cost control per `tutor_runtime_config`. Session creation: rate-limited to prevent abuse.

## **Exam Integrity**

Exam integrity enforced through: server-authoritative timer (§17), zero grace period, UI tutor absence \+ server warning (§21), module locking, review gate, Module 2 routing server-authority with no-variant-disclosure (§18).

## **Idempotency**

client\_attempt\_id prevents duplicate writes from retries, double-clicks, multi-tab. Data integrity control and UX smoothness feature.

## **Embeddings Security**

`copilot.question_embeddings` is the target read path (RLS-locked, service\_role only). `public.question_embeddings` is legacy with unrestricted grants flagged for deletion per CR-02B-27. This is a current-state security gap; migration to copilot-schema-only usage closes it.

## **Audit Logging**

Security-relevant actions (auth events, entitlement changes, exam tutor invocations, admin actions, Module 2 routing decisions) logged to audit trail separate from runtime logs. Retained longer, queryable for investigation.

## **Why This Matters**

Security controls are invisible layer. When working, no one notices. When failing, often catastrophic.

## **Verification Before Refactor**

Inspect authentication validation, verify entitlement checks server-side, confirm rate limiting active, test exam integrity scenarios (strategic disconnect, direct-API tutor invocation), verify `public.question_embeddings` access pattern and migration status, audit logging completeness.

---

# **33\. Constants Doctrine**

## **Principle**

All runtime-affecting constants live in DB configuration tables. No magic numbers in runtime code affecting user-visible behavior, timing, pricing, or learning algorithm. This is INV-02B-15 as a cross-cutting architectural rule, enforced at CI level per §31.

## **Why This Rule Matters**

Lyceon's runtime must be tunable operationally without code deploys. Marketing wants to try 50 quota instead of 40? Config change, not deploy. SM-2 intervals need tuning based on usage data? Config change. Module 2 thresholds need adjustment based on scaled score distribution? Config change. The cost is paid once (set up tables, load code); benefit recurs every tuning decision and every operational incident.

The rule also simplifies auditability. When a value changes, there's one record in a constants audit trail. When a bug report says "the quota seemed wrong," operations can check the config history in seconds rather than searching git history for when the code constant was last modified.

## **Pattern: Domain-Specific Constants Tables**

Following the existing `mastery_constants` and `kpi_constants` pattern, runtime constants are grouped into domain-specific tables rather than one generic config:

* `mastery_constants` (exists) — mastery math configuration (governed by Doc 02C)  
* `kpi_constants` (exists) — KPI weights and scaling (governed by Doc 02C)  
* `full_length_adaptive_config` (exists) — Module 2 routing thresholds and rules  
* `practice_runtime_config` (proposed) — quota, session defaults, inactivity, recency  
* `review_runtime_config` (proposed) — SM-2 intervals, ease factors, graduation  
* `exam_runtime_config` (proposed) — section durations, break duration, reconnect  
* `tutor_runtime_config` (proposed) — rate limits, review answer-withhold mode, exam invocation response

Proposed tables subject to verification at implementation time per naming doctrine. The pattern — domain-specific table with key-value rows, audit trail on changes — is established.

## **Constants Governance**

* **No magic numbers.** Any numeric threshold, interval, count, or timing value read from DB.  
* **Owners named.** Each constant has an owner:  
  * Product: quota, session UX defaults, tier limits  
  * Engineering: timeouts, retry counts, rate limits  
  * Content ops: policy configuration, review/schedule tuning  
* **Bounds defined.** Min/max values prevent misconfigurations. Example: `daily_quota_free` must be between 10 and 200\.  
* **Descriptions required.** Each row explains what constant controls.  
* **Changes audited.** Every change records old/new value, timestamp, actor in a constants audit trail table.  
* **Environment parity.** Dev, staging, production have their own values but same schema.

## **Constants Change Governance**

Changes to constants follow these rules:

* **Who approves:** Owner approves for their constants (product for product-owned, engineering for technical, content ops for content-owned). Founder/CTO approval required for changes affecting revenue, user experience, or integrity (quota, entitlement, exam timing, Module 2 thresholds).  
* **How to deploy:** Constants changes are DB updates, not code deploys. Standard operational pathway (not requiring PR merge and release).  
* **How to audit:** Constants audit trail table records: key, old\_value, new\_value, changed\_at, changed\_by, reason. Queryable for investigation.  
* **Environment promotion:** Changes to prod constants are normally tested in dev/staging first. Emergency changes can go directly to prod with post-hoc audit.

## **Effective-Window Semantics**

Different constants have different effective-window behavior:

* **Quota changes take effect at next reset,** not mid-day. A user who has submitted 38 questions against a 40-quota doesn't suddenly gain or lose access when the quota changes.  
* **SM-2 interval changes take effect on next schedule computation,** not retroactively. Already-scheduled review items keep their existing `next_review_at` until they're processed.  
* **Exam timer changes take effect on next exam session,** not in-flight exams. Students don't have their section time change mid-exam.  
* **Rate limits take effect immediately** (next tutor invocation uses new limit).  
* **Selection algorithm changes take effect on next session creation,** not mid-session. Already-prefilled session\_items are preserved.

Implementation teams honor these windows; constants changes avoid mid-transaction behavioral changes.

## **A/B Testing of Constants**

A/B testing constants is rare and governed separately. Standard operational changes flip a constant for all users. If a constant needs A/B testing, it requires product decision, explicit methodology (what's being measured, sample size, duration), and separate tooling (not the standard constants update path). Constants doctrine is about operational tunability, not experimentation infrastructure.

## **Read Pattern**

Runtime reads constants at startup and caches with TTL. Hot-reload via cache invalidation or bounded cache TTL. Emergency changes don't require process restart.

Implementation detail: each domain-specific config table has a canonical read function (`getPracticeRuntimeConfig()`, `getReviewRuntimeConfig()`, etc.) that returns a typed configuration object. Runtime code consumes the typed object; does not query DB directly for each constant lookup.

## **Magic Numbers Prohibition**

No numeric literal affecting user-visible behavior, timing, pricing, or learning algorithm may appear in runtime code. Every such value read from config.

Allowed exceptions:

* Collection indices (0, 1, ...) when operating on fixed-shape data  
* Obviously-one values (1 for "first", 0 for "none")  
* Exponent or power values in well-known formulas where the value is part of the formula identity (e.g., `0.5` in a square-root operation)  
* HTTP status codes (200, 400, 401, 403, 404, 409, 500, 503\)

Prohibited:

* Quota counts (e.g., `if (count >= 40)`)  
* Timeouts and durations (e.g., `24 * 3600`)  
* Interval values (e.g., `1` for days between reviews)  
* Threshold comparisons (e.g., `if (rawScore >= 18)`)  
* Rate limit values (e.g., `100` for hourly rate)  
* Difficulty weights or multipliers

CI enforces via static analysis (§31).

## **Why This Matters**

The "all constants in DB" rule makes the runtime tunable operationally without code changes. Marketing experimentation doesn't require eng cycles. Emergency adjustments (quota too restrictive, timer too tight) are hot-fix-able. Audit trails give operations visibility. Engineers aren't blocked by marketing decisions; product isn't blocked by deploys; operations can respond to incidents without code review.

The cost is the one-time setup of tables, cached read infrastructure, CI enforcement, and discipline to add new constants to the catalog. The benefit is every subsequent tuning decision.

## **Verification Before Refactor**

Inspect current magic numbers in runtime code, identify ones affecting user-visible behavior (candidates for config), verify existing constants tables match expected schema, plan migration of hardcoded values to DB, verify CI static analysis catches new magic numbers at PR time.

---

# **34\. Known Architectural Debt**

This section documents architectural debt identified through schema and repository audits. Each item has a resolution owner and a status.

## **Multi-Writer on `profiles` (B6) — Doc 01 owns**

Five files currently write to `profiles`: profile-service.ts, profile-bootstrap.ts, guardian-routes.ts, guardian-consent-routes.ts, profile-routes.ts, supabase-auth-routes.ts. Identity table with five independent write paths is a consistency hazard. Consolidation to a single canonical writer is Doc 01 scope.

Runtime (02B) reads `profiles.id` and `profiles.role` for auth context and assumes eventual consistency across writers.

## **Cross-Domain Writes (B7) — Doc 05 owns**

Routes like account-deletion-routes (writes to entitlements), notification-routes (duplicates notification-authority), legal-routes (writes to legal\_acceptances) write outside their nominal domain. Consolidation is Doc 05 scope.

Runtime (02B) does not depend on these for its own domains (practice, review, full-length, tutor); flagged for awareness.

## **Dual Account System — Doc 01 owns**

`accounts`/`account_members` live via `ensure_account_for_user` RPC. `lyceon_accounts`/`lyceon_account_members` have policies but may be orphaned.

Target state: entitlement linked to `profiles.id` directly; both account tables retired. Doc 01 scope with direct implications for runtime entitlement reads in §12.

## **Legacy Event Tables Phasing Out — Runtime team owns**

`practice_events` and `review_session_events` are legacy event writers. Canonical truth is `practice_session_items` and `review_session_items`. Migration flagged per CR-02B-28. Runtime team owns the phase-out.

## **Dual Exam Form Tables — Runtime team \+ Content ops own**

`test_forms`/`test_form_items` is current read path in `fullLengthExam.ts`. `exam_forms`/`exam_form_items` is current write path in `exam-form-write.ts`. Migration incomplete per CR-02B-21. Runtime team owns the read-path migration; content ops owns form rebuild on the new tables.

## **Wave 1 FKs to `users.id` — Doc 01 owns**

`attempts`, `audit_logs`, `chat_messages` still FK to legacy `users`. Migration to `profiles` pending, Doc 01 scope.

## **Unrestricted `public.question_embeddings` — Runtime team \+ Security own**

RLS disabled, anon+authenticated grants, runtime uses. Target: migrate to `copilot.question_embeddings`, delete public variant. CR-02B-27. Runtime team owns migration; security owns sign-off.

## **Duplicate Policies on Full-Length Family (B1) — DBA / Migration owns**

Each full-length table has two PERMISSIVE policy sets (`flx_*` and `*_own`). Functionally identical but noisy. Cleanup: drop one set.

## **Duplicate Timestamp Triggers on `usage_daily` — DBA owns**

Two `updated_at` triggers. Drop one.

## **Duplicate `updated_at` on `profiles` — Doc 01 / DBA owns**

Both `updated_at` and `_updated_at` columns. Drop one.

## **Why This Matters**

Known debt documented is debt that can be addressed intentionally. Silent debt is debt that becomes the bug report. This section serves future engineers who encounter these patterns — they know the current state is transitional, not the target — and gives operations clear ownership for each cleanup.

---

# **35\. Change Control**

Meaningful changes to runtime behavior follow Preamble §8 change control. Every change requires:

1. Proof of current behavior (from inspection, not assumption)  
2. Proposed replacement  
3. Migration plan  
4. Rollback path  
5. Success metrics  
6. Changelog record

Cross-file changes, invariant changes, or structural scope changes require Founder \+ CTO approval per Preamble §8.

High-risk changes (reveal-matrix enforcement, scoring pipeline, Module 2 routing, entitlement logic, mastery RPC contract, constants doctrine enforcement) approved at Founder \+ CTO level regardless of apparent scope.

---

# **36\. Verification Before Refactor Checklist**

Before any refactor or re-implementation of components in this document, gather proof from the actual system:

## **Identity and Access**

* Current `profiles` read paths in runtime  
* Verify role resolution uses `profiles.role` enum  
* Confirm guardian linkage via `guardian_links`  
* Verify MFA integration with `auth.mfa_factors`

## **Entitlement and Quota**

* Current `entitlements` read path and which account-system table it joins  
* `ensure_account_for_user` RPC destination  
* Quota tracking against `practice_session_items`  
* Response shapes for gated and quota-exhausted requests  
* Zero-quota session-creation refusal behavior  
* CTA rendering on client

## **Session Prefill**

* `practice_session_items` prefill at session creation (not on-demand)  
* Denormalized snapshot columns on session\_items  
* `full_length_exam_questions` prefill timing (Module 1 at session create, Module 2 at routing)  
* Snapshot immutability — retiring underlying question does not mutate snapshot

## **Reveal Matrix**

* Current response payloads at each question-serving endpoint  
* Explicit field inclusion (no implicit leakage)  
* Absence of feature flags or debug modes overriding reveal rules  
* Tutor-in-review context construction (no correct\_answer, no explanation)  
* Module 2 variant not disclosed in API responses

## **Selection Logic**

* Current selection algorithm in `practice-canonical.ts`  
* Mastery-read integration (reads from `student_skill_mastery`)  
* Determinism given same inputs  
* Recency check implementation

## **Review and SM-2**

* `review_schedule` table existence status (target-state addition)  
* Review entry trigger on practice/exam miss  
* Launch vs target SM-2 logic state  
* Tutor-assisted correctness equivalence tracking (used\_tutor flag capture)

## **Exam Engine**

* `fullLengthExam.ts` read path (test\_forms vs exam\_forms)  
* Adaptive Module 2 routing implementation (server-side, no variant leakage)  
* Routing failure handling (retry, alert, no default variant)  
* Timer server-authoritative  
* Multi-device reconnect behavior  
* Auto-submit on expiry  
* Break-skip and auto-start behavior

## **Tutor Runtime**

* Surface-awareness in `tutor-runtime.ts`  
* Review-mode context excludes correct\_answer and explanation at API level  
* Exam-context warning-nudge  
* Entitlement enforcement server-side  
* Rate-limit enforcement and mid-session throttling  
* Telemetry completeness

## **Mastery RPC**

* `apply_learning_event_to_mastery` RPC body and signature  
* Runtime call sites (only `mastery-write.ts` should call)  
* Versioned event payload contract  
* No direct mastery table writes from runtime  
* RPC failure handling

## **Constants Doctrine**

* Inventory of current magic numbers in runtime code  
* Existing constants tables (`mastery_constants`, `kpi_constants`, `full_length_adaptive_config`) match expected schema  
* Migration plan for hardcoded values to DB  
* CI static analysis catches new magic numbers

## **Event Tables Phasing Out**

* Current `practice_events` and `review_session_events` write paths  
* Migration plan to session\_items as canonical  
* Timeline for legacy table deletion

## **Embeddings Security**

* Current read path (`public` vs `copilot.question_embeddings`)  
* Grants on `public.question_embeddings`  
* Migration status

## **Observability and Security**

* Current logging library and redaction  
* Metrics coverage  
* Audit logging

Only after gathering these should a team propose a specific refactor with verified current state, target state per this spec, migration path, rollback path.

---

# **37\. Cross-Document Dependencies**

This document depends on and is depended on by the following specs:

## **Governed By**

* **Doc 00** (Authoritative Platform Directive) — platform-level invariants  
* **Doc 01** (Identity, Access, Billing & Guardian Trust) — identity, entitlement, guardian model  
* **Doc 02 Preamble V3** — cross-cutting invariants and reveal matrix

## **Depends On**

* **Doc 02A** (Question Generation) — content supply chain produces inventory this runtime serves  
* **Coding Standards** — monorepo layout, TypeScript strict mode, Zod at boundaries, logging redaction, pnpm, testing thresholds

## **Depended On By**

* **Doc 02C** (Mastery, KPIs, DB) — 02C consumes the event stream produced by 02B runtime; owns mastery algorithm, analytics export  
* **Doc 03** (Tutor Architecture, future) — 03 owns tutor model and prompt internals; 02B §21 governs when tutor is accessible and what context it receives  
* **Doc 04** (Calendar, Planning, future) — 04 implements the review-first scheduling priority flagged by 02B §16  
* **Doc 05** (Trust, Growth, Compliance, future) — 05 owns cross-domain concerns flagged in §34 (cross-domain writes, public surfaces)  
* **Doc 06** (Expansion, future) — 06 governs non-SAT exam family expansion; 02B §4 is structured for parametric exam family support

## **Why This Matters**

Every document in the 02 suite operates within a network of dependencies. Changes here may require coordinated updates elsewhere. Explicit dependency listing prevents orphaned contract changes.

---

# **38\. Final Principles**

Lyceon's runtime should feel dependable. Students should trust that questions appear correctly, answers save correctly, timers are fair, progress is preserved, premium gates are clear and honest, exams are legitimate, review sessions help them actually learn, mastery accumulates from real effort, and the system behaves consistently across sessions.

That trust is not a feature. It is the product. A brilliant question bank served through an unreliable runtime is indistinguishable from a broken product. Every invariant in this document exists to protect one of several properties:

* **Anti-leak integrity**, because academic trust depends on answers staying hidden until earned  
* **Session continuity**, because lost progress is the fastest way to lose a user  
* **Idempotency**, because duplicate writes corrupt every downstream system  
* **Server authority**, because client-trusted state is adversarial surface  
* **Exam integrity**, because trust anchors must actually anchor trust  
* **Adaptive authenticity**, because SAT-like practice must use SAT-like adaptation  
* **Pedagogical coherence**, because each surface must serve its learning role  
* **Mastery fidelity**, because the RPC boundary keeps computation clean  
* **Event faithfulness**, because the world model Lyceon is building depends on clean data  
* **Constants-in-DB discipline**, because operational tunability without deploy is power  
* **Naming abstraction**, because specs describe intent and survive DB evolution  
* **Determinism**, because debuggability requires reconstructable behavior

The runtime is the surface students feel. Get it right, and the content moat becomes experienced value. Get it wrong, and the content moat becomes invisible.

Protect the runtime with the same discipline as the content factory. Both are the moat.

---

# **39\. Change Records**

## **CR-02B-01**

**Previous Rule:** Runtime behavior scattered across PDF-03, PDF-04, PDF-05 review sections, PDF-QR §10-11, PDF-WM instruction layer. **Updated Rule:** Runtime behavior consolidated into Doc 02B as single authoritative specification. **Why:** Separate specs produced drift. Consolidation makes runtime contract auditable. **Build Impact:** All runtime behavior governed by 02B.

## **CR-02B-02**

**Previous Rule:** Freemium model undefined. **Updated Rule:** Free tier \= 40 practice questions per day, midnight America/Chicago reset. All other features (review, tutor, exams, mastery detail, calendar) premium. **Why:** Fixed-time reset creates anticipation UX; simplifies engineering; US-focused product. **Build Impact:** Quota tracking reset at midnight America/Chicago; CTA countdown.

## **CR-02B-03**

**Previous Rule:** Review as similar-question remediation (PDF-05 §8). **Updated Rule:** Review as original-item replay with SM-2 spaced repetition, tutor-led pre-submission reasoning. **Why:** Pedagogically stronger; spaced repetition is best-in-class for concept learning. **Build Impact:** New `review_schedule` table; review surface UI supports continuous due queue.

## **CR-02B-04**

**Previous Rule:** Full SM-2 algorithm at launch. **Updated Rule:** Launch with simplified scheduling (single correct retry graduates); target state enables full SM-2. Schema supports both. **Why:** Ship usable behavior quickly; gather data to inform full algorithm; pure logic upgrade later. **Build Impact:** Schema in place at launch; simplified logic initially.

## **CR-02B-05**

**Previous Rule:** PDF-05 §7.3 tutor-helped mastery modifier events. **Updated Rule:** Tutor interactions logged but do not emit mastery-bearing events. Mastery from unaided attempts only. **Why:** Tutor mastery impact hard to measure honestly; cleaner model; preserves "mastery is earned." **Build Impact:** No tutor-helped mastery events; tutor interaction tables capture full context for future analysis.

## **CR-02B-06**

**Previous Rule:** Exam resume permissive. **Updated Rule:** Server-continuous timer, zero grace, auto-submit on expiry. Strict SAT-grade trust anchors. **Why:** Integrity requires tamper-resistance; any grace creates strategic-pause exploits; matches Bluebook. **Build Impact:** Timer server-only; remaining time computed server-side on every request.

## **CR-02B-07**

**Previous Rule:** Exam tutor blocked entirely. **Updated Rule:** Exam tutor UI-absent during active exam; server-side invocations return warning-nudge with telemetry logging. Not hard-blocked. **Why:** Hard-block creates frustration for students with abandoned-but-active exams needing tutor for unrelated study; warning-nudge preserves integrity via social pressure and audit trail. **Build Impact:** Tutor endpoint checks active exam; returns warning response with timer remaining; logs invocation.

## **CR-02B-08**

**Previous Rule:** Per-student exposure ledger for repeat avoidance. **Updated Rule:** Rely on question bank volume plus Fisher-Yates selection. No per-student exposure tracking. **Why:** Engineering complexity not justified when volume solves problem. **Build Impact:** No exposure ledger; freshness preference in selection provides some protection pre-launch.

## **CR-02B-09**

**Previous Rule:** Default practice count not specified. **Updated Rule:** Per `practice_runtime_config.default_session_count_web` (20) and `default_session_count_mobile` (10). Platform-aware defaults. **Why:** Different session-length intuitions for different contexts; 20 is half free daily quota. **Build Impact:** Server accepts platform parameter; default varies by platform; user can override within bounds.

## **CR-02B-10**

**Previous Rule:** Free user mastery visibility unclear. **Updated Rule:** Free users see final overall score projection only. Premium users see full breakdown. Mastery computed for all; visibility tiered. **Why:** Final projection creates conversion curiosity; detailed breakdown creates learning actionability. **Build Impact:** 02C computes mastery for all; UI surfaces tier appropriately; upgrade reveals full history.

## **CR-02B-11**

**Previous Rule:** Reaction policy scattered across PDF-QR §10-11 and PDF-WM. **Updated Rule:** Reaction policy layer consolidated into 02B with policy families, launch vs target state, assignment and exposure recording, forbidden experimentation zones. **Why:** Inherently runtime behavior. **Build Impact:** Policy assignment and exposure tables; default-variant-only at launch; Fisher-Yates seeded selection at target; forbidden zones enforced.

## **CR-02B-12**

**Previous Rule:** Telemetry architecture unspecified. **Updated Rule:** Canonical runtime state via session\_items, attempts, rollups; analytics export (02C scope) derives from them. No separate event-stream layer; legacy `*_events` tables phasing out. **Why:** Clean separation; append-only discipline preserves historical record; session\_items capture final-state not event-stream. **Build Impact:** Session\_items are the canonical state; analytics export reads from them; 02B scope ends at canonical state.

## **CR-02B-13**

**Previous Rule:** Exam form count unspecified. **Updated Rule:** 4 full-length forms at launch, Bluebook parity. Each form contains Module 1 \+ two Module 2 variants per section. Ramp to 6+ post-launch. **Why:** Matches official standard; achievable via 02A pipeline. **Build Impact:** Content operations produce 4 approved forms (with all Module 2 variants) before launch.

## **CR-02B-14**

**Previous Rule:** Exam form assembly ownership unclear. **Updated Rule:** Forms assembled in product repo; target-state tables are `exam_forms`/`exam_form_items`; legacy `test_forms`/`test_form_items` phasing out. **Why:** Separates content generation from form assembly; aligns with production database. **Build Impact:** Product repo owns form tables; 02A output consumed for form content; migration to exam\_forms in-flight.

## **CR-02B-15**

**Previous Rule:** Naming asserted throughout V1 drafts. **Updated Rule:** Spec describes intent and behavior. Names verified from schema where confirmed. Every operational section carries verification-before-refactor. **Why:** DB drift is correctness bug; intent-first language survives naming variation. **Build Impact:** Implementation verifies names from production; spec doesn't assert.

## **CR-02B-16**

**Previous Rule:** SM-2 tutor-assistance weighting unclear. **Updated Rule:** Tutor-assisted correctness \= unaided for SM-2 at launch (provisional). UI guidance encourages unaided on repeat reviews. `used_tutor` flag recorded for post-launch analysis. Revisit with data. **Why:** Since tutor in review architecturally cannot leak the answer (CR-02B-29), tutor-assisted correctness is guided reasoning, not cheating. Equivalence is a hedge until launch data informs refinement. **Build Impact:** SM-2 treats correctness as correctness; review UI includes pedagogical copy; `used_tutor` recorded.

## **CR-02B-17**

**Previous Rule:** Identity canonical unclear. **Updated Rule:** `profiles` is canonical identity. `users` deprecated. Role resolution via `profiles.role` enum. **Why:** Schema audit confirms `profiles` is new canonical; `users` is Wave 1 fossil. **Build Impact:** All runtime identity reads use `profiles.id` and `profiles.role`. Wave 1 tables FK'd to `users` are legacy.

## **CR-02B-18**

**Previous Rule:** Question bank gating unclear (blanket-auth vs course-gated policies). **Updated Rule:** Questions are authenticated-read at MVP. Course-gating dropped. `questions_select_accessible` policy to be removed. No question version history tracking at MVP. **Why:** Lyceon has no course/org feature; course-gating is anticipation of unbuilt model. Version history not needed for MVP scope. **Build Impact:** Runtime selection reads questions for authenticated users without course constraint; `question_versions` receives minimal use.

## **CR-02B-19**

**Previous Rule:** Quota enforced mid-session. **Updated Rule:** Quota pre-capped at session creation. Session target adjusted to remaining quota. CTA at session start, not mid-session. Zero-quota refuses session creation with countdown. **Why:** Better UX; no mid-session surprise breakage. **Build Impact:** Session creation checks remaining quota and caps target count or refuses.

## **CR-02B-20**

**Previous Rule:** Question selection on-demand at serve time. **Updated Rule:** Session items prefilled at session creation (practice and exam Module 1). Full target\_count selected once and written to session\_items with denormalized snapshots. Serve reads from prefilled session\_items. **Why:** Deterministic, resilient to network failures, audit-friendly, testable. Tradeoff: less mid-session adaptation acceptable. **Build Impact:** Selection algorithm runs at session creation; session\_items written up-front; `/next` returns prefilled items.

## **CR-02B-21**

**Previous Rule:** Full-length exams use static forms. **Updated Rule:** Full-length uses adaptive Module 2 routing per real SAT. Forms contain Module 1 \+ two Module 2 variants per section. Routing decision based on Module 1 raw score vs `full_length_adaptive_config` threshold. Target form table: `exam_forms`; legacy: `test_forms`. **Why:** SAT-authentic behavior; matches Bluebook; adaptive measurement precision. **Build Impact:** Form blueprints contain variants; routing server-authoritative with no client disclosure; Module 2 prefilled after Module 1 submission; migration from test\_forms to exam\_forms in-flight.

## **CR-02B-22**

**Previous Rule:** Constants hardcoded in runtime. **Updated Rule:** All runtime constants live in DB configuration tables. Pattern: domain-specific tables following `mastery_constants`/`kpi_constants`. No magic numbers in runtime code. CI static analysis enforces. Change governance per §33. **Why:** Operational tunability without deploy; audit trail on changes; environment parity; simplifies auditability across the repo. **Build Impact:** Runtime reads constants from DB at startup with cache TTL; new `*_runtime_config` tables proposed for 02B domains; CI tests enforce no-magic-numbers rule.

## **CR-02B-23**

**Previous Rule:** Review scheduling via session-bound tables only. **Updated Rule:** SM-2 scheduling via new `review_schedule` table per (profile, question). Separate from session-bound `review_session_items`. **Why:** SM-2 needs per-(user, question) state beyond session scope. **Build Impact:** New table added to target-state schema; launch uses simplified logic with schema in place.

## **CR-02B-24**

**Previous Rule:** Account system assumed consolidated on `lyceon_accounts`. **Updated Rule:** Current-state RPC `ensure_account_for_user` writes to legacy `accounts`/`account_members`; these are live via RPC, not dead. Target-state: entitlement linked directly to `profiles.id`; account tables retired. **Why:** Schema audit inverted prior assumption; repo audit confirmed RPC writes to legacy tables. Target simplification eliminates separate account concept. **Build Impact:** Entitlement reads currently traverse `account_members`; migration to direct-profile-link requires RPC refactor and schema changes (Doc 01 scope).

## **CR-02B-25**

**Previous Rule:** `public.question_embeddings` assumed acceptable. **Updated Rule:** `public.question_embeddings` is legacy with unrestricted grants; flagged for deletion. Runtime should use `copilot.question_embeddings` exclusively. **Why:** Unrestricted embeddings expose content metadata to anon/authenticated clients — security leak vector. **Build Impact:** Migrate runtime reads to `copilot.question_embeddings`; drop `public.question_embeddings`.

## **CR-02B-26**

**Previous Rule:** Option B entitlement \= each account owns entitlement. **Updated Rule:** Target-state entitlement \= each profile owns entitlement via `entitlements.profile_id → profiles.id`. Guardian payment relationships via `guardian_links`. No separate account table needed. Student entitlement lives on student profile regardless of payer. **Why:** Simplification; profile is already the identity and billing unit (`stripe_customer_id` on profiles); account tables are unnecessary indirection. **Build Impact:** Doc 01 revision pass to reflect; target-state schema changes entitlement FK; RPC refactored to not create account rows.

## **CR-02B-27**

**Previous Rule:** Embeddings read path ambiguous. **Updated Rule:** `copilot.question_embeddings` is target. `public.question_embeddings` scheduled for deletion. **Why:** Security posture requires service-role-only access on embeddings. **Build Impact:** Current reads via `supabase.ts:106` to be migrated; after migration, `public.question_embeddings` dropped.

## **CR-02B-28**

**Previous Rule:** `practice_events` and `review_session_events` are canonical event log. **Updated Rule:** Session\_items and attempts tables are the canonical runtime state record. `practice_events` and `review_session_events` are legacy event writers being phased out. **Why:** Session\_items carry all necessary information in denormalized final-state form; separate event-stream tier is unnecessary duplication. **Build Impact:** Migrate remaining `practice_events` writers to session\_items; plan deletion of legacy event tables.

## **CR-02B-29**

**Previous Rule:** Tutor-in-review receives correct\_answer in prompt context, prevented from leaking via prompt engineering. **Updated Rule:** Tutor-in-review does NOT receive correct\_answer or explanation in context. Architectural answer-withholding: tutor guides reasoning with what it has (stem, options, passage, student's in-progress reasoning). **Why:** Prompt-engineering constraint is best-effort; architectural guarantee is hard. Cannot leak what you don't have. **Build Impact:** `tutor-runtime.ts` review-mode context construction omits correct\_answer and explanation; tutor prompt adapted for guide-without-answer mode.

## **CR-02B-30**

**Previous Rule:** Exam cancellation not specified. **Updated Rule:** Student may cancel an in-progress exam. Cancellation marks the session abandoned; no scoring runs; no mastery events emit. Student may start a new attempt. **Why:** Practice context should allow abandonment (differs from real SAT where submission is final). **Build Impact:** Cancellation endpoint on `fullLengthExam.ts`; session state transitions to abandoned; no downstream effects.

## **CR-02B-31**

**Previous Rule:** Exam break behavior unspecified. **Updated Rule:** Break duration per `exam_runtime_config.break_duration_seconds` (600 at launch); break is free time not counted against section timers; student may skip via explicit action; skip ends break immediately and starts next section; expiration auto-starts next section. **Why:** Match Bluebook break behavior while allowing student autonomy to skip. **Build Impact:** Break state on `full_length_exam_sessions`; skip endpoint; auto-transition on break timer expiry.

---

# **40\. Worked Examples**

## **Example One: Free User Practice with Pre-Cap and Quota Exhaustion**

A free user opens the app at 9:30pm America/Chicago. They have submitted 38 practice questions earlier in the day.

**Session creation.** User clicks "Start Practice." Client sends session creation request with target\_count 20 (default web), platform "web." Server validates authentication via Supabase Auth, loads `profiles.id` and `profiles.role = 'student'`. Entitlement check: free tier, remaining quota \= 40 \- 38 \= 2 (reads `practice_runtime_config.daily_quota_free`). Server pre-caps target\_count to 2 per CR-02B-19. Selection runs with weakness-weighted Fisher-Yates: picks 2 questions matching "Flow" mode filters. Writes 2 rows into `practice_session_items` with position 1 and 2, denormalized snapshots including stem, options, correct\_answer, explanation, option\_metadata, domain, skill, difficulty. Returns session identifier and target 2\.

Client UI shows "Practice: 2 questions (remaining today)" with CTA messaging about upgrade.

**First question.** Client requests next. Server loads session, finds position-1 session\_item with status pending, marks status served, returns payload: stem, options (A/B/C/D with text), passage=null, assets, position=1. No correct\_answer, no explanation, no option\_metadata.

User thinks, selects B, submits with client\_attempt\_id. Server validates ownership, checks idempotency (new), fetches the snapshot's correct\_answer=D from session\_item, evaluates: B is wrong. Persists onto session\_item: selected\_answer=B, is\_correct=false, outcome='incorrect', time\_spent\_ms=42000, answered\_at=now. Triggers mastery RPC with practice\_incorrect event for this question's skill at difficulty 2\. Response to client includes is\_correct=false, correct\_answer=D, explanation text from snapshot.

Behind the scenes: a review queue entry is created (free user accumulation per §12). Mastery RPC updates student\_skill\_mastery, student\_domain\_mastery, student\_cluster\_mastery.

**Second question.** Same flow. User answers correctly. Session\_item updated. Mastery RPC fires with practice\_correct event.

**Quota exhaustion.** Client requests next question. Server checks: session has no more pending items (target was 2, both answered). Marks session status completed. Client UI shows completion screen with CTA modal: "You've reached today's free limit. Upgrade to unlock unlimited practice, interactive tutor, review with spaced repetition, and full-length exams. Or wait — resets at midnight Central."

Countdown to midnight Central: 2h 30m. UI shows timer.

**Mastery side-effect.** Both mastery RPC calls updated profile's mastery. Final score projection recomputes (small adjustment). User sees updated projection on their dashboard (single number, no breakdown).

**Conversion moment.** User clicks upgrade, completes payment. Entitlement flips to premium. Next session: all historical mastery unlocks into detailed view. The review entry from the wrong answer is now visible and has SM-2 schedule.

## **Example Two: Premium User Full-Length Exam with Adaptive Module 2**

A premium user starts Full-Length Practice Test 2 on Saturday morning.

**Exam start.** User selects test, confirms start. Server validates premium entitlement via `entitlements` read. Validates no other active exam. Reads the form blueprint from current read path (`test_forms` currently; `exam_forms` target). Form contains: Module 1 RW (28 questions), Module 1 Math (22 questions), Module 2 RW easier \+ harder variants, Module 2 Math easier \+ harder variants.

Creates `full_length_exam_sessions` with started\_at=now, section durations from `exam_runtime_config`. Creates `full_length_exam_modules` rows for Module 1 RW and Module 1 Math with state='pending'. Prefills `full_length_exam_questions` with all Module 1 items (ordered per form). Module 2 NOT prefilled yet.

Session state: active-module-1-rw. Timer running.

**Module 1 RW.** User works through 28 questions. Server serves each question from prefilled snapshot. Client displays with remaining time. No tutor UI. No reveals.

User submits final RW Module 1 answer at \~35 minutes in. Submits the module (UI "End Section"). Server locks Module 1 RW. Updates `full_length_exam_modules` row to state='completed'.

**Adaptive routing for RW.** Server runs routing: counts correct answers in Module 1 RW. Reads threshold from `full_length_adaptive_config.rw_m1_threshold_raw_score`. User's raw \= 22/28; threshold \= 18\. User routes to harder Module 2 RW. Updates `full_length_exam_modules` with module\_2\_variant='harder', routing\_raw\_score=22, routing\_threshold\_used=18, routing\_config\_version='v1', routed\_at=now. Prefills `full_length_exam_questions` with the harder variant's items for RW Module 2\.

API response to client does NOT include variant label (INV-02B-14). Client receives the next module's questions.

**Break.** After Module 2 RW submission, user enters break. Break timer from `exam_runtime_config.break_duration_seconds` (600s). User takes 8 minutes, clicks "Continue to Math." Break ends immediately. Math Module 1 starts.

**Module 1 Math.** Same flow. User answers 22 Math Module 1 questions. User has access to Desmos (collapsible panel, available on math). Formula sheet accessible. Submits Module 1 Math.

**Adaptive routing for Math.** Server routes. User's Math M1 raw \= 12/22; threshold \= 14\. User routes to easier Module 2\. Prefills easier variant.

**Module 2 RW.** User works through the harder variant (unknown to them which variant — API response doesn't disclose).

**Module 2 Math.** User works through the easier variant (unknown).

**Completion.** All four modules submitted. Server transitions session to completed. Scoring pipeline runs:

* RW raw: 22 (M1) \+ 24 (M2 harder) \= 46 out of 54  
* Math raw: 12 (M1) \+ 20 (M2 easier) \= 32 out of 44  
* RW scaled: 640 (harder variant allows full range)  
* Math scaled: 580 (easier variant caps around 620\)  
* Total scaled: 1220  
* Domain breakdown: Algebra 70%, Problem Solving 60%, Advanced Math 50%, etc.  
* Skill breakdown: linear functions 80%, ratios 55%, etc.

Writes score\_rollup. Triggers mastery RPC with exam completion events (per-item granularity) — higher weighting than practice per Doc 02C rules.

**Review unlock.** Dashboard shows completed exam with scaled scores (labeled "Scaled using official SAT methodology"), domain accuracy (labeled "Learning Diagnostic"), skill signals (labeled "Learning Signal"). Student can now enter review phase — see correct answers, explanations, per-question correctness with diagnostic breakdowns.

**Key note:** student does not see which Module 2 variants they got. Just their scaled scores. Same as real SAT. The routing audit trail lives on `full_length_exam_modules` for operations inspection if needed.

## **Example Three: SM-2 Review Trajectory for One Item Over 30 Days**

Premium user missed question Q47 in a practice session on Day 0\.

**Day 0:** Miss recorded. `review_schedule` entry created: repetition\_count=0, interval\_days=1 (from `review_runtime_config.sm2_initial_interval_days`), ease\_factor=2.5 (from `sm2_initial_ease_factor`), next\_review\_at=Day 1, status=active.

**Day 1:** Review queue shows Q47 as due. User opens. Tutor panel available pre-submit. User reasons with tutor (tutor has stem and options but NOT correct answer, per CR-02B-29). Tutor guides: "What approach would you try?" User articulates, tutor prompts further. User submits answer — correct. SM-2 update: repetition\_count=1, interval\_days=1, ease\_factor=2.55 (slight up, capped at max), next\_review\_at=Day 2\. Review entry persisted; mastery RPC fires with review\_correct event. Used\_tutor=true flag recorded.

**Day 2:** Q47 due again. User attempts unaided this time (UI guidance encouraged it). Submits correctly. SM-2 update: repetition\_count=2, interval\_days=6 (from `sm2_second_interval_days`), ease\_factor=2.55, next\_review\_at=Day 8\. Q47 drops out of daily queue.

**Day 8:** Q47 due. User attempts unaided. Submits correctly. SM-2: repetition\_count=3, interval\_days=15 (6 × 2.55), ease\_factor=2.55, next\_review\_at=Day 23\.

**Day 23:** Q47 due. User attempts unaided. Submits INCORRECTLY this time. SM-2 reset: repetition\_count=0, interval\_days=1, ease\_factor=2.35 (slight down, floored at `sm2_ease_factor_min`\=1.3), next\_review\_at=Day 24\. Mastery RPC fires with review\_incorrect event.

**Day 24:** Q47 due. User attempts. Submits correctly. repetition\_count=1, interval\_days=1, next\_review\_at=Day 25\.

**Day 25:** Q47. Correct unaided. repetition\_count=2, interval\_days=6, next\_review\_at=Day 31\.

**Day 31:** Q47. Correct unaided. repetition\_count=3, interval\_days=14 (6 × 2.35), next\_review\_at=Day 45\.

... and so on. After eventually reaching repetition\_count=5 (from `sm2_graduation_repetition_count`) with interval reaching \~60 days, Q47 graduates (status=graduated, graduated\_at=timestamp). Drops out of review queue permanently unless student misses the same concept in future practice (which creates a new review\_schedule entry).

**Note on launch behavior:** At launch, `sm2_graduation_repetition_count` is 1 and `sm2_second_interval_days` simplified — a single correct retry graduates the item. The trajectory above represents target-state behavior. The schema supports both; logic upgrade is a pure code change per CR-02B-04.

## **Example Four: Tutor-in-Review with Architectural Answer-Withholding**

Premium user opens their review queue on Day 5\. Item Q83 is due — they missed it in practice on Day 3\.

**Session start.** User clicks Q83 in review queue. Server creates `review_sessions` row for this session (or continues an active one), creates `review_session_items` row with snapshot from original miss, serves the question. No correct answer or explanation in the payload.

**Tutor invocation.** User reads the question. It's a complex algebra problem. User clicks "Get tutor help."

Client sends tutor invocation request:

* session\_id \= review\_session\_123  
* session\_item\_id \= review\_item\_456  
* surface\_context \= "review-pre-submit"  
* message \= "I'm not sure where to start"  
* conversation\_id \= new

Server `tutor-runtime.ts` constructs tutor context per §21:

* Includes: question stem, passage (none for this algebra problem), options (A/B/C/D with text), student's message  
* **Excludes: correct\_answer, explanation, option\_metadata** (per CR-02B-29)

Tutor endpoint receives context and generates Socratic response: "Let's think about what this problem is asking. Can you identify what the variable represents in the equation?"

Because tutor doesn't know the correct answer, it cannot accidentally leak it. It asks guiding questions. Server logs invocation to `tutor_conversations` and `tutor_messages`.

**Student-tutor exchange.** Over 4 turns, tutor guides user through identifying the variable, setting up the equation, and reasoning about the answer. Student arrives at answer C.

**Submission.** User submits C with client\_attempt\_id. Server validates, fetches snapshot's correct\_answer (C), evaluates: C is correct. Persists outcome to `review_error_attempts`: selected\_answer=C, is\_correct=true, outcome='correct', used\_tutor=true, answered\_at=now.

SM-2 update on `review_schedule`: repetition\_count→1 (from 0 after original miss), interval\_days=1, next\_review\_at=Day 6\. Mastery RPC fires with review\_correct event (includes used\_tutor=true in telemetry but doesn't affect mastery math per INV-02B-11).

**Response to client.** Post-submit reveal: correct\_answer=C (matches), full explanation text. Tutor remains available to discuss reasoning.

**What the architecture guaranteed.** Throughout the entire interaction, the tutor never had access to the correct answer. It couldn't leak it accidentally, couldn't be jailbroken into leaking it, couldn't confirm or deny student guesses. The student demonstrated reasoning under guided scaffolding — per CR-02B-16, this counts equivalently for SM-2 at launch, with `used_tutor` captured for post-launch analysis.

## **Why These Examples Matter**

Abstract spec language cannot convey runtime behavior the way a traced example can. Each example above has specific data, specific state transitions, specific server responses, specific DB writes, specific constants references. An engineer implementing against this spec has concrete targets to match. The examples are behavior contracts made concrete.

---

# **41\. Appendix A — Runtime Constants Catalog**

This appendix enumerates every runtime constant referenced in this document, its domain-specific table, launch value, bounds, owner, and description. This is the authoritative catalog for INV-02B-15 enforcement.

## **practice\_runtime\_config**

| Key | Launch Value | Min | Max | Owner | Description |
| ----- | ----- | ----- | ----- | ----- | ----- |
| `daily_quota_free` | 40 | 10 | 200 | Product | Practice questions per day for free tier |
| `quota_reset_timezone` | America/Chicago | — | — | Product | Timezone for daily quota reset boundary |
| `default_session_count_web` | 20 | 1 | 60 | Product | Default session target on web |
| `default_session_count_mobile` | 10 | 1 | 60 | Product | Default session target on mobile |
| `max_session_count_premium` | 60 | 10 | 120 | Product | Maximum session target for premium users |
| `inactivity_timeout_hours` | 24 | 1 | 168 | Engineering | Hours before abandoned session timeout |
| `recency_window_days` | 14 | 1 | 90 | Product | Recent-seen window for freshness preference |
| `session_presets` | \[5, 10, 15, 20\] | — | — | Product | Preset session count buttons |

## **review\_runtime\_config**

| Key | Launch Value | Min | Max | Owner | Description |
| ----- | ----- | ----- | ----- | ----- | ----- |
| `sm2_initial_interval_days` | 1 | 1 | 7 | Product | Interval after first successful retrieval |
| `sm2_second_interval_days` | 6 | 3 | 14 | Product | Interval after second successful retrieval |
| `sm2_initial_ease_factor` | 2.5 | 1.3 | 3.0 | Product | Starting ease factor for new items |
| `sm2_ease_factor_min` | 1.3 | 1.0 | 1.5 | Product | Floor for ease factor |
| `sm2_ease_factor_max` | 2.5 | 2.0 | 3.5 | Product | Ceiling for ease factor |
| `sm2_graduation_repetition_count` | 1 (launch) / 5 (target) | 1 | 10 | Product | Consecutive successes to graduate item |
| `tutor_assisted_equivalence` | true | — | — | Product | Whether tutor-assisted correct \= unaided for SM-2 |

## **exam\_runtime\_config**

| Key | Launch Value | Min | Max | Owner | Description |
| ----- | ----- | ----- | ----- | ----- | ----- |
| `rw_section_duration_seconds` | 3840 (64 min) | 1800 | 7200 | Product | Reading & Writing total section duration |
| `math_section_duration_seconds` | 4200 (70 min) | 1800 | 7200 | Product | Math total section duration |
| `break_duration_seconds` | 600 (10 min) | 0 | 1800 | Product | Between-section break duration |
| `reconnect_grace_seconds` | 0 | 0 | 60 | Product | Grace on reconnect (locked at zero for integrity) |
| `exam_session_abandon_hours` | 24 | 1 | 48 | Engineering | Hours before exam session auto-abandoned without start |

## **full\_length\_adaptive\_config**

| Key | Launch Value | Min | Max | Owner | Description |
| ----- | ----- | ----- | ----- | ----- | ----- |
| `rw_m1_threshold_raw_score` | (product decision) | 0 | 28 | Product | Raw score threshold for RW Module 2 routing |
| `math_m1_threshold_raw_score` | (product decision) | 0 | 22 | Product | Raw score threshold for Math Module 2 routing |
| `tie_break_rule` | route\_easier | — | — | Product | Behavior at exact-threshold raw score |
| `module_2_variant_labels` | \[easier, harder\] | — | — | Product | Canonical variant labels |
| `config_version` | v1 | — | — | Product | Configuration version for audit trail |

## **tutor\_runtime\_config**

| Key | Launch Value | Min | Max | Owner | Description |
| ----- | ----- | ----- | ----- | ----- | ----- |
| `rate_limit_per_profile_per_hour` | (product decision) | 5 | 200 | Product | Tutor invocations per hour per premium profile |
| `rate_limit_per_profile_per_day` | (product decision) | 20 | 1000 | Product | Tutor invocations per day per premium profile |
| `review_answer_withhold_mode` | architectural | — | — | Engineering | How answer-withholding is enforced (CR-02B-29) |
| `exam_invocation_response` | warning\_nudge | — | — | Product | Response type for tutor invoked during active exam |
| `conversation_resume_launch_mode` | discard | — | — | Product | Launch behavior for tutor conversation on disconnect |
| `tutor_request_timeout_seconds` | 30 | 5 | 120 | Engineering | Max wait for tutor response before timeout |

## **mastery\_constants (governed by Doc 02C, listed here for completeness)**

Values for `alpha`, `difficulty_multipliers`, event deltas, and mastery level boundaries. See Doc 02C for authoritative catalog.

## **kpi\_constants (governed by Doc 02C, listed here for completeness)**

Values for KPI weights, scaling factors, band thresholds. See Doc 02C for authoritative catalog.

## **Constants Audit Trail Schema**

All constants changes recorded:

constants\_audit\_log (  
  id uuid primary key,  
  config\_table text,  
  key text,  
  old\_value jsonb,  
  new\_value jsonb,  
  changed\_at timestamptz,  
  changed\_by uuid,  
  reason text  
)

Queryable for incident investigation.

## **Why This Matters**

This catalog is the single source of truth for what must live in DB per INV-02B-15. Any constant referenced in the document body and not listed here is either (a) an oversight to be added, or (b) not actually a runtime constant (HTTP status code, collection index, etc.). CI enforcement in §31 tests that every constant in this catalog has a corresponding DB row and that no additional magic numbers appear in runtime code.

