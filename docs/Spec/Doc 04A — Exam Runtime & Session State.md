# **Doc 04A — Exam Runtime & Session State**

**Version:** V2.2 **Status:** **LOCKED 2026-05-12** — absorbs Parent V3.0 inherited constraints; ChatGPT SWE review cleanup applied within lock cycle (no version bump; 8 cleanup items per Change Records) **Scope:** SAT MVP — full-length exam runtime **Audience:** Engineering, QA, Ops **Owns:** session lifecycle, section state machine, server-authoritative timing, routing decision execution, **form-publish gate**, answer submission, idempotency, resume behavior, mode flag semantics, abandonment \+ partial-scoring runtime triggers, runtime API surface, runtime event outbox, **canonical answer state for downstream consumers (04B scoring, Doc 05 mastery)** **Does NOT own:** scoring computation (04B), report payloads (04C), audit \+ observability completeness (04D), question authoring (Doc 02), tutor coordination logic (Doc 03), mastery formula (Doc 05), entitlement implementation (Doc 01), scoring model versioning catalog (04B V4.3 §7)

**Supersedes:** Doc 04A V2.1 (closes V2.1→V2.2 review findings driven by Parent V3.0 lock 2026-05-12; see V2.2 closeout register below). V2.1's 5 V2.0→V2.1 closeouts and V2.0's 11 V1→V2 closeouts carry forward unchanged and are listed below for audit completeness.

**Depends on:** Doc 04 Parent V3.0 (LOCKED 2026-05-12). Doc 04B V4.3 (spec-locked 2026-05-12; deploy-time attestation values `validation_packet_url` and `constants_sha256` pending — see Parent V3.0 §14). Doc 02 series (Question Bank & Canonical Content). Doc 01 (Identity, Roles & Entitlement). Doc 00 (Authoritative Platform Directive).

**Keywords.** MUST, MUST NOT, SHOULD, SHOULD NOT, MAY follow RFC 2119\.

---

## **V2.2 closeout register**

V2.2 closes review findings driven by Parent V3.0's lock. All entries derive from Parent V3.0 RB-V3-XX entries plus the reviewer's 10-point mandate for 04A V2.2.

| ID | Type | Change | Section(s) |
| ----- | ----- | ----- | ----- |
| RB-V22-01 | BLOCKER | **`form_equating_offset` column removed from `test_forms`** (Parent V3.0 RB-V3-02; reviewer mandate 1). Schema migration drops the column. The published-form immutability trigger no longer checks it. All references throughout V2.1 removed. | §5.1, §5.1.1 (migration note), §16 supersession crosswalk |
| RB-V22-02 | BLOCKER | **`test_forms.score_table_version` is now a foreign key into `scoring_model_versions(version)`** (Parent V3.0 RB-V3-03; reviewer mandate 2). Type remains `text`; constraint added. The catalog table is owned by 04B V4.3 §7.2; 04A consumes the version PK. | §5.1 |
| RB-V22-03 | BLOCKER | **New form-publish gate (§6)** (reviewer mandate 3). Publish-time gate enforces: (a) `score_table_version` references an existing `scoring_model_versions` row with `status = 'active'`; (b) routing thresholds are in expected range OR a Founder/CTO override is recorded; (c) module composition matches 04B V4.3 §13 locked composition via the canonical `validate_form_composition()` function. Enforcement is split across a DB trigger (a, b) and the application-level publish handler (c). | §6 (NEW) |
| RB-V22-04 | BLOCKER | **New columns `routing_override_approved_by` and `routing_override_reason` on `test_forms`** (Parent V3.0 §13 risk \#4). Routing thresholds outside T\_rw ≈ 18–21 or T\_math ≈ 13–16 require these to be non-null at publish time. | §5.1, §6.2 |
| RB-V22-05 | BLOCKER | **New invariant: missing answer rows are valid blanks** (Parent V3.0 §11.2; V4.3 §11; reviewer mandate 7). 04B scoring uses LEFT JOIN against `test_form_items` so missing rows in `test_session_answers` count as blank/wrong. 04A guarantees the canonical-answer-state contract for both 04B and Doc 05 — no separate event publication, no fan-out. | §4 invariants (\#13 new), §5.6, §13.4 |
| RB-V22-06 | BLOCKER | **Doc 04 → Doc 05 mastery-event emission is removed** (Parent V3.0 RB-V3-07; reviewer mandate 6). 04A's `exam_runtime_outbox` event types remain `test_session_completed` and `test_session_partial_scored_abandoned`; no new event types for mastery. Doc 05 reads `test_session_answers JOIN questions` directly when drafted. Hard guarantee \#11 of Parent V3.0 applies. | §3 inherited constraints, §5.7, §13 |
| RB-V22-07 | non-blocking | **Structural reorganization to match the reviewer's 19-section layout.** V2.1's §7 (question serving \+ answer submission) is now split into §10 (question serving \+ anti-leak projection), §11 (answer submission \+ idempotency), §12 (module submission). V2.1's §4.4 (completion) is now §13. New §3 (Parent V3.0 inherited constraints) makes inheritance explicit. V2.1's §11 (mode flag implementation summary) becomes §8.6. V2.1's §13 (what this document does not specify) is absorbed into §3 inherited constraints. | All; navigation tweak |
| RB-V22-08 | non-blocking | **`module2_path` internal-only doctrine reaffirmed** (Parent V3.0 §9 \#15; V4.3 §17; reviewer mandate 8). 04A §9.3 (routing visibility) preserved verbatim; cross-reference to V4.3 §17 disclosure doctrine added. | §9.3 |
| RB-V22-09 | non-blocking | **Strict/lenient timer semantics preserved entirely** (reviewer mandate 9). No change to V2.1 §5 timing logic. §8.6 mode-flag implementation summary table preserved. | §8 (was V2.1 §5), §8.6 (was V2.1 §11) |
| RB-V22-10 | non-blocking | **Review unlock dependency on completion \+ `score_run` success reaffirmed** (Parent V3.0 §9 \#9; reviewer mandate 10). 04A does not unlock review; 04C does, gated on `score_runs` row existence per V4.3. 04A's completion handler (§13) writes the outbox row, then 04B's orchestrator writes `score_runs`, then 04C reads `score_runs` to gate review unlock. | §3 inherited constraints, §13 |

---

## **V2.1 closeout register (carried forward)**

V2.1 closed 5 review findings against V2.0 (2 BLOCKER, 3 non-blocking). All accepted.

| ID | Type | Change | Section(s) |
| ----- | ----- | ----- | ----- |
| RB-V21-01 | BLOCKER | V2.0's `last_submission_id` column on `test_session_answers` had a comment saying "references `test_answer_submissions(id)`" but no real foreign key. V2.1 reorders the schema so `test_answer_submissions` is defined before `test_session_answers`, and the FK is declared inline at the column definition. | §5.5, §5.6 |
| RB-V21-02 | BLOCKER | V2.0's `active_implies_started` CHECK constraint required `active_section IS NOT NULL` for both `active` AND `section_break` states, conflicting with the state-machine rule that `active_section` is cleared on entry to `section_break`. V2.1 splits the constraint into three: `started_state_has_started_at` (covers both states), `active_has_active_section` (only `active`), `break_has_no_active_section` (only `section_break`). | §5.3 |
| RB-V21-03 | non-blocking | V2.0's `attempt_number_for_form` computation read from session history then inserted, leaving a race window where two concurrent create requests could compute the same number against pre-completion history. V2.1 wraps session creation in a per-student PostgreSQL advisory lock to serialize concurrent creates and produce consistent attempt numbers. | §7.3 |
| RB-V21-04 | non-blocking | V2.0 stored `response_json` for idempotency replay but did not version the response schema. A later API revision could produce a response shape incompatible with the replay path. V2.1 adds `response_schema_version` to `test_answer_submissions` so replays carry their original API version. | §5.5, §11.2 |
| RB-V21-05 | non-blocking | Two related improvements: (a) outbox `failed` status semantic clarified as "terminal dead-letter after retry exhaustion, not ordinary transient failure"; (b) session-create flow now eagerly finalizes any past-grace prior session inline rather than relying on the next sweep, eliminating the up-to-5-minute wait that V2.0 implied. | §5.7, §7.3 |

---

## **V2.0 closeout register (carried forward)**

V2.0 closed 11 review findings against V1.0 (6 BLOCKER, 5 non-blocking). All accepted. Section references below refer to V2.0/V2.1 numbering; in V2.2 the equivalents are noted parenthetically.

| ID | Type | Change | V2.0/V2.1 Section(s) | V2.2 Section(s) |
| ----- | ----- | ----- | ----- | ----- |
| RB-V2-01 | BLOCKER | Lenient-mode timer formula had a sign inconsistency between §5.2 and §11 of V1. V2 introduces a single canonical helper `effective_expires_at = module_expires_at + active_paused_ms + currently_paused_ms` and references it everywhere. The `remaining_ms` computation reduces to `max(0, effective_expires_at - clock_timestamp())` uniformly. | §5.2, §11 | §8.2, §8.6 |
| RB-V2-02 | BLOCKER | V1's `grace_expires_at` was enforced only by the abandonment sweep, leaving a window where API handlers continued serving active requests past the grace boundary. V2 adds API-level grace enforcement: every session-bound endpoint rejects requests with `409 session_grace_expired` when the session is non-terminal AND past `grace_expires_at`. The sweep retains exclusive ownership of state transitions to abandonment-final states. | §2 invariants, §8.6, §10 API preconditions | §4 invariants, §14.6, §16 API preconditions |
| RB-V2-03 | BLOCKER | V1 used a single `test_session_answers` table for both canonical state and idempotency, which made delayed-retry semantics incorrect: a stale retry could overwrite a newer canonical answer. V2 splits the schema into `test_answer_submissions` (append-only idempotency ledger) and `test_session_answers` (canonical state); the former carries the full `response_json` for replay; the latter is updated under last-write-wins with a `last_submission_id` reference. | §3.5, §3.6, §7.3 | §5.5, §5.6, §11 |
| RB-V2-04 | BLOCKER | V1's heartbeat used multiple SQL statements and a read-then-write pattern that left a race window for concurrent heartbeats from multiple tabs. V2 collapses to a single atomic UPDATE with a CASE expression that folds pending pause into `active_paused_ms` in one statement. | §5.3 | §8.3 |
| RB-V2-05 | BLOCKER | V1 had no rejection rule for answer submits against already-submitted modules. V2 adds invariant: any answer write where the section is past `module1_active` (for module=1) or past `module2_active` (for module=2A/2B) MUST return `409 module_submitted`. | §2 invariants, §7.3 | §4 invariants (\#6), §11 |
| RB-V2-06 | BLOCKER | V1's completion handler wrote `session.state = 'completed'` and inserted an outbox row in separate transactions, creating an observable window where downstream consumers could see a completed session with no event. V2 collapses completion writes (state \+ outbox) into a single transaction. | §4.4 | §13 |
| RB-V2-07 | non-blocking | V1's session state diagram did not distinguish `module1_active` from `module2_active` clearly. V2 adopts a per-section state machine and removes the V1 `expired` state in favor of `submitted` with `submitted_by = 'timeout'`. | §3.4, §4.1 | §5.4, §7.1 |
| RB-V2-08 | non-blocking | V1 stored `client_instance_id` on `test_sessions`, conflicting with multi-tab behavior. V2 moves instance tracking to per-request audit metadata on `test_answer_submissions` (or equivalent). | §3.3, §9.3 | §5.3, §15.3 |
| RB-V2-09 | non-blocking | V1 did not specify section-break behavior as soft vs hard. V2 documents `break_duration_ms` as suggested-not-enforced. | §6.4 | §9.4 |
| RB-V2-10 | non-blocking | V1 did not specify answer format compatibility across question types. V2 adds §7.3.1 documenting multiple-choice (letter) vs student-produced response (raw string). | §7.3.1 | §11.1 |
| RB-V2-11 | non-blocking | V1's API surface lacked a single state-read endpoint. V2 adds `GET /api/tests/sessions/:session_id/state`. | §9.1, §10 | §15.1, §16 |

---

## **1\. Purpose**

Doc 04A defines the **runtime contract** for a Lyceon full-length exam session: how a session is created, how state progresses through modules, how timing is enforced, how routing is decided and locked, how answers are captured, how completions and abandonments fire downstream events, and how the runtime stays correct under network failures, concurrent access, and resume.

V2.2 absorbs Parent V3.0's lock and the V4.3 scoring-architecture decisions that flowed through it. The runtime layer:

* **Owns:** canonical answer state, session lifecycle, server-authoritative timing, routing decision execution, the **form-publish gate** that prevents misconfigured forms from being scored, and the `exam_runtime_outbox` mechanism that publishes completion and partial-abandonment events to 04B.  
* **Does NOT own:** scoring math (04B V4.3), report payload construction (04C), audit-event enumeration (04D), question content (Doc 02), tutor coordination (Doc 03), mastery state (Doc 05), entitlement implementation (Doc 01).

The runtime is **server-authoritative**: every state transition, timer computation, and routing decision happens on the server. The client renders state but does not own state.

**What changed from V2.1:** the scoring-architecture parts of `test_forms` (per Parent V3.0): `form_equating_offset` is removed; `score_table_version` is now a foreign key into `scoring_model_versions(version)`; a new publish gate (§6) prevents forms from being marked `published` unless three conditions hold (active scoring version, valid routing thresholds or recorded override, and locked module composition). Two new invariants are added (\#13 missing-answer-rows-are-valid-blanks, \#14 canonical-answer-state-contract-for-downstream-consumers). The structural reorganization follows the Parent V3.0 reviewer's 19-section layout. Everything else is preserved from V2.1.

---

## **2\. V2.2 closeout register**

See the V2.2 closeout register table at the top of this document. The 10 entries map 1:1 to Parent V3.0's RB-V3-XX entries plus the reviewer's mandate items for 04A V2.2.

---

## **3\. Parent V3.0 inherited constraints**

This section catalogs the architectural constraints Parent V3.0 hands down to 04A. They are not negotiable at the 04A level; changes require Parent revision.

### **3.1 No mastery event emission (Parent V3.0 RB-V3-07, RB-V3-08; hard guarantee \#11)**

Per RB-V3-08, Doc 05 (mastery, when drafted) is committed to reading canonical answer state directly from `test_session_answers JOIN questions` — it is NOT a consumer of any Doc 04 event. 04A's `exam_runtime_outbox` emits exactly two event types:

* `test_session_completed`  
* `test_session_partial_scored_abandoned`

04A MUST NOT add `test_pass`, `test_fail`, `mastery_*`, `test_question_event`, or any per-question downstream event type. Mastery consumption by Doc 05 is sourced from canonical `test_session_answers JOIN questions` directly. The outbox event types above feed only 04B's scoring orchestrator, not Doc 05\.

If Doc 05 (when drafted) requires per-question event publication, that requirement is a Parent V3.0 revision; 04A MUST NOT silently introduce it.

### **3.2 Canonical answer state contract for downstream consumers (Parent V3.0 §11.2)**

`test_session_answers` is the canonical source-of-truth for what the student answered. It satisfies these properties:

* One row per `(test_session_id, section, module, ordinal)` when an answer is recorded  
* **Missing rows** (no answer submitted for a question) **are valid blanks** — 04B uses LEFT JOIN against `test_form_items` to compute the answer set (V4.3 §11)  
* Answer values respect the question-type contract in §11.1  
* The table is readable by 04B's scoring orchestrator and by Doc 05's (future) mastery consumer; 04A does not interpose itself

### **3.3 No scoring math in 04A (reviewer mandate 5\)**

04A computes Module 1 raw scores only for the purpose of executing the routing decision (§9.1). 04A does NOT:

* Compute section scaled scores  
* Apply ceiling, deduction, or floor formulas  
* Read `scoring_constants` or `scoring_model_versions` rows beyond the publish-time FK check  
* Persist `score_runs`, `score_run_event_ledger`, or any 04B-owned artifact

The shared answer comparator (`is_answer_correct` per V4.3 §10) is the only function 04A shares with 04B. It is a pure function on a question record and an answer string; calling it does not constitute scoring.

### **3.4 Routing visibility — internal only (Parent V3.0 §9 \#15; V4.3 §17)**

`test_session_sections.module2_path` is internal-only. It is captured for audit and for 04B scoring (which reads it to apply the correct M2 difficulty distribution). It MUST NOT appear in any student-facing or guardian-facing API response, report field, or UI element. Admin / audit responses MAY expose it.

### **3.5 Review unlock — not 04A's job (Parent V3.0 §9 \#9)**

04A does not unlock review mode. 04A writes the completion outbox event, which 04B's orchestrator consumes to write `score_runs`. 04C's report endpoint reads `score_runs` and gates review unlock on its presence and success. If 04B's scoring fails permanently (V4.3 §19.6 unattested-version path), `score_runs` is never written and 04C reads from 04D's failure ledger / incident metadata to surface `failed_requires_review` (Parent V3.0 §10.2).

### **3.6 04B / 04C / 04D ownership boundaries**

For clarity (none of these belong to 04A):

* **Score computation:** how `test_session_answers` becomes a scaled score is owned by 04B V4.3.  
* **Report payload structure:** student and guardian payloads are owned by 04C.  
* **Audit event completeness:** which events fire on which state transitions is jointly owned with 04D; 04A describes state transitions and the outbox primitive, 04D enumerates the observability events that wrap them.  
* **Question content:** stems, options, correct answers, domain metadata are owned by Doc 02; 04A consumes them by ID.  
* **Tutor coordination:** Doc 03 governs tutor behavior while the session is `active`; 04A exposes session state via `GET /state`, Doc 03 reads it.  
* **Entitlement implementation:** Doc 01 owns what "active product entitlement that includes full-length exams" means in storage; 04A calls Doc 01's predicate.

---

## **4\. Hard runtime invariants**

These cannot be violated. Tests verify them. Schema enforces them where possible.

1. **Server time is the only time.** Section expiration, routing eligibility, grace-window boundaries, and abandonment cutoffs all derive from `clock_timestamp()` on the server. Client-supplied timestamps are informational only and are never used in state decisions.  
2. **One active full-length session per student.** A student cannot start a new full-length exam while another is in any non-terminal state (`created`, `active`, `section_break`). New-session requests against existing active sessions return the existing session's identifier, not a new row.  
3. **Routing locks at Module 1 submit.** Once a section's Module 1 is submitted (by student action or timeout), the routed Module 2 path (`A` or `B`) is written to the section row and is immutable for the lifetime of the session. Resume reads the locked path; no recomputation.  
4. **Published form items are immutable.** A session bound to `test_form_id = X` always serves the same Module 1 question set, the same Module 2A set, and the same Module 2B set. Form content changes require a new form, not a mutation.  
5. **Idempotent answer submission.** Two POSTs with the same `(test_session_id, idempotency_key)` produce one canonical answer state and one submission-ledger row, and both POSTs return the identical response. Replay NEVER corrupts canonical state regardless of when the replay arrives.  
6. **Module answers lock at module submit.** Once a module's section state transitions out of `module1_active` or `module2_active` (by student submit or timeout), answer writes for that module's questions MUST be rejected with `409 module_submitted`. The schema enforces this via state-aware preconditions; no answer write can succeed against a non-active module.  
7. **API-level grace enforcement.** Any session-bound API request against a non-terminal session whose `grace_expires_at < clock_timestamp()` MUST be rejected with `409 session_grace_expired`. The sweep job (§14) retains exclusive ownership of the actual state transition to abandonment-final states.  
8. **Pre-completion payloads exclude answer-revealing fields.** Question payloads served during an active section omit `correct_answer`, `explanation`, distractor labels, and any field whose presence leaks correctness.  
9. **Resume returns the same state.** A student who closes their browser mid-section and returns within the relevant grace window sees the same module, the same questions in the same order, the same answers they already entered, and the correct remaining time (computed per mode).  
10. **Section timers cannot be extended by the client.** The remaining-time field served to the client is informational. The server enforces section expiration regardless of what the client believes.  
11. **Mode flag affects timer-decrement behavior only.** Strict and lenient sessions produce identical session-state outputs given identical answer submissions at identical server timestamps. The only behavioral divergence is whether elapsed real-time during browser-close counts against the section timer.  
12. **State-changing events are published through the outbox.** Every state transition that downstream consumers depend on (completion, partial-scored abandonment) writes an outbox row in the same database transaction as the state change. The publisher worker forwards from outbox; no state-change event is published outside this path.  
13. **Missing answer rows are valid blanks (V2.2 — NEW per RB-V22-05).** `test_session_answers` contains a row only for questions where the student submitted an answer (including explicit-null submissions). Questions with no submission have no row. 04B scoring uses LEFT JOIN against `test_form_items` so missing rows count as blank/wrong per V4.3 §11. 04A MUST NOT write placeholder rows with `answer = NULL` for un-submitted questions; absence is the correct signal.  
14. **Canonical answer state is the sole downstream contract (V2.2 — NEW per RB-V22-05/06).** 04A guarantees `test_session_answers JOIN questions` is sufficient for both 04B scoring and Doc 05 mastery. 04A MUST NOT emit per-question downstream events; the `exam_runtime_outbox` carries only session-level transitions (`test_session_completed`, `test_session_partial_scored_abandoned`).  
15. **Form-publish gate is enforced (V2.2 — NEW per RB-V22-03; Parent V3.0 RB-V3-12 hard guarantees \#17 \+ \#18).** A `test_forms` row cannot transition to `status = 'published'` unless: (a) its `score_table_version` references a `scoring_model_versions` row with `status = 'active'` (Parent V3.0 hard guarantee \#17: scoring model must be attested before scoring); (b) its routing thresholds are within the expected range OR a Founder/CTO override is recorded; (c) its module composition matches the locked 04B V4.3 §13 composition per `validate_form_composition()`. Conditions (a) and (b) are DB-trigger-enforced; condition (c) is application-handler-enforced. Parent V3.0 hard guarantee \#18 (constants sealed after activation) is enforced by V4.3 itself; 04A inherits the consequence (forms bind only to currently-active versions).  
16. **Partial scoring eligibility requires Module 2 submitted (V2.2 — NEW per V2.2 lock-cycle BL4).** A section is eligible for partial scoring only after its Module 2 reaches state `submitted` (whether by student-initiated submit or by Module 2 timeout). Module 1 submission alone — whether student-submitted or auto-routed by Module 1 timeout — does NOT produce a scoreable partial section. A session abandoned with one section in `module1_submitted` and the other section in `submitted` ends as `partial_scored_abandoned`, but the partial-scoring outbox payload (§14.4) flags the `module1_submitted` section as not-scored. A session abandoned with BOTH sections only in `module1_submitted` ends as `abandoned_final` (no scoreable section) — the sweep classifies on `submitted` count, not `module1_submitted` count.

---

## **5\. Data model**

All times are `timestamptz` (UTC at storage; client display in student-local timezone).

V2.2 changes from V2.1 schema are concentrated in §5.1 (`test_forms`). Tables 5.2–5.7 are preserved verbatim from V2.1.

### **5.1 `test_forms` (V2.2 — schema change)**

Published test forms. Immutable after publish.

CREATE TABLE test\_forms (  
  id                    uuid PRIMARY KEY,  
  name                  text NOT NULL,  
  test\_kind             text NOT NULL CHECK (test\_kind IN ('full\_length')),  
  status                text NOT NULL CHECK (status IN ('draft', 'published', 'archived')),  
  is\_selectable         boolean NOT NULL DEFAULT true,  
  retired\_for\_new\_sessions\_at  timestamptz NULL,  
  score\_table\_version   text NOT NULL REFERENCES scoring\_model\_versions(version),  
  routing\_threshold\_rw  int  NOT NULL CHECK (routing\_threshold\_rw BETWEEN 0 AND 27),  
  routing\_threshold\_m   int  NOT NULL CHECK (routing\_threshold\_m BETWEEN 0 AND 22),  
  routing\_override\_approved\_by  uuid NULL REFERENCES admins(id),  
  routing\_override\_reason       text NULL,  
  routing\_override\_ticket\_id    text NULL,  
  break\_duration\_ms     int  NOT NULL,  
  rw\_module1\_ms         int  NOT NULL,  
  rw\_module2\_ms         int  NOT NULL,  
  m\_module1\_ms          int  NOT NULL,  
  m\_module2\_ms          int  NOT NULL,  
  created\_at            timestamptz NOT NULL DEFAULT now(),  
  published\_at          timestamptz,  
  archived\_at           timestamptz,

  CONSTRAINT published\_has\_publish\_time CHECK (  
    (status \= 'published' AND published\_at IS NOT NULL) OR  
    (status \<\> 'published')  
  ),  
  CONSTRAINT archived\_has\_archive\_time CHECK (  
    (status \= 'archived' AND archived\_at IS NOT NULL) OR  
    (status \<\> 'archived')  
  ),  
  CONSTRAINT override\_pair\_both\_or\_neither CHECK (  
    (routing\_override\_approved\_by IS NULL  
       AND routing\_override\_reason IS NULL  
       AND routing\_override\_ticket\_id IS NULL) OR  
    (routing\_override\_approved\_by IS NOT NULL  
       AND routing\_override\_reason IS NOT NULL  
       AND routing\_override\_ticket\_id IS NOT NULL)  
  ),  
  CONSTRAINT retired\_only\_when\_published CHECK (  
    retired\_for\_new\_sessions\_at IS NULL OR status IN ('published', 'archived')  
  ),  
  CONSTRAINT retired\_implies\_not\_selectable CHECK (  
    retired\_for\_new\_sessions\_at IS NULL OR is\_selectable \= false  
  )  
);

**V2.2 schema changes from V2.1 (including V2.2 lock-cycle cleanup):**

| Column | V2.1 → V2.2 | Reason |
| ----- | ----- | ----- |
| `score_table_version` | `text NOT NULL` → `text NOT NULL REFERENCES scoring_model_versions(version)` | Parent V3.0 RB-V3-03; binds form to canonical scoring version catalog |
| `form_equating_offset` | column existed → **column dropped** | Parent V3.0 RB-V3-02; per-form offsets retired with the 3-layer model |
| `is_selectable` | (did not exist) → `boolean NOT NULL DEFAULT true` | V2.2 lock-cycle BL1; separates "scoreable for historical sessions" from "selectable for new sessions"; Product/Content runbook flips `false` when retiring a form whose bound version is superseded |
| `retired_for_new_sessions_at` | (did not exist) → `timestamptz NULL` | V2.2 lock-cycle BL1; audit timestamp set when `is_selectable` flips to `false`; implies `is_selectable = false` per the `retired_implies_not_selectable` CHECK |
| `routing_threshold_rw` | `int NOT NULL` → `int NOT NULL CHECK (… BETWEEN 0 AND 27)` | Bounds check; total RW M1 items |
| `routing_threshold_m` | `int NOT NULL` → `int NOT NULL CHECK (… BETWEEN 0 AND 22)` | Bounds check; total Math M1 items |
| `routing_override_approved_by` | (did not exist) → `uuid NULL REFERENCES admins(id)` | V2.2 RB-V22-04 \+ lock-cycle MED1; records Founder/CTO admin identity (FK to `admins`) when thresholds outside expected range; UUID FK instead of free text for audit-grade enforcement |
| `routing_override_reason` | (did not exist) → `text NULL` | V2.2 RB-V22-04; justification for override |
| `routing_override_ticket_id` | (did not exist) → `text NULL` | V2.2 lock-cycle MED1; references the operational ticket recording the override decision; scoring-impacting overrides require ticket discipline |
| `CONSTRAINT override_pair_both_or_neither` | (did not exist) → CHECK extended to all 3 override columns | All three override columns must be present together or absent together |
| `CONSTRAINT retired_only_when_published` | (did not exist) → CHECK | `retired_for_new_sessions_at` may only be set on `published` or `archived` forms |
| `CONSTRAINT retired_implies_not_selectable` | (did not exist) → CHECK | Setting `retired_for_new_sessions_at` requires `is_selectable = false` |

**Published-form immutability trigger (updated for V2.2 schema):**

CREATE OR REPLACE FUNCTION enforce\_published\_form\_immutability() RETURNS trigger AS $$  
BEGIN  
  IF OLD.status \= 'published' AND (  
    NEW.score\_table\_version IS DISTINCT FROM OLD.score\_table\_version OR  
    NEW.routing\_threshold\_rw IS DISTINCT FROM OLD.routing\_threshold\_rw OR  
    NEW.routing\_threshold\_m IS DISTINCT FROM OLD.routing\_threshold\_m OR  
    NEW.routing\_override\_approved\_by IS DISTINCT FROM OLD.routing\_override\_approved\_by OR  
    NEW.routing\_override\_reason IS DISTINCT FROM OLD.routing\_override\_reason OR  
    NEW.routing\_override\_ticket\_id IS DISTINCT FROM OLD.routing\_override\_ticket\_id OR  
    NEW.break\_duration\_ms IS DISTINCT FROM OLD.break\_duration\_ms OR  
    NEW.rw\_module1\_ms IS DISTINCT FROM OLD.rw\_module1\_ms OR  
    NEW.rw\_module2\_ms IS DISTINCT FROM OLD.rw\_module2\_ms OR  
    NEW.m\_module1\_ms IS DISTINCT FROM OLD.m\_module1\_ms OR  
    NEW.m\_module2\_ms IS DISTINCT FROM OLD.m\_module2\_ms  
  ) THEN  
    RAISE EXCEPTION 'Published forms are immutable. Archive and republish.';  
  END IF;  
  \-- is\_selectable and retired\_for\_new\_sessions\_at are intentionally mutable post-publish.  
  \-- They are operational toggles for retiring a form from new selection without  
  \-- archiving (which would also break historical reproducibility on running sessions).  
  RETURN NEW;  
END;  
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg\_published\_form\_immutability  
  BEFORE UPDATE ON test\_forms  
  FOR EACH ROW EXECUTE FUNCTION enforce\_published\_form\_immutability();

The `form_equating_offset` check is removed; checks for the three override columns are added; `is_selectable` and `retired_for_new_sessions_at` are intentionally NOT in the immutability list because they are post-publish operational toggles (BL1 lock-cycle cleanup). Everything else preserved.

**Form-to-scoring-version binding immutability (Parent V3.0 RB-V3-04; §6 reaffirmation):** once `status = 'published'`, `score_table_version` is immutable per the trigger above. This satisfies the Parent V3.0 RB-V3-04 invariant: form-to-version binding is sealed at publish time and cannot be silently relinked. If the referenced `scoring_model_versions` row later transitions from `active` to `superseded` (because a future v2.0 activates), this form continues to score against its bound version per V4.3 §7.5 historical-reproducibility rule. The FK enforces version existence; the trigger enforces post-publish immutability; the publish gate (§6) enforces `active` status at publish time.

#### **5.1.1 Migration note (V2.1 → V2.2)**

Schema migration MUST execute in this order to avoid leaving rows in an invalid state:

1. Add `is_selectable boolean NOT NULL DEFAULT true` and `retired_for_new_sessions_at timestamptz NULL` columns (V2.2 lock-cycle BL1).  
2. Add `routing_override_approved_by uuid NULL REFERENCES admins(id)`, `routing_override_reason text NULL`, and `routing_override_ticket_id text NULL` columns (V2.2 RB-V22-04 \+ lock-cycle MED1).  
3. Add `override_pair_both_or_neither` CHECK constraint covering all three override columns.  
4. Add `retired_only_when_published` and `retired_implies_not_selectable` CHECK constraints (V2.2 lock-cycle BL1).  
5. Drop `form_equating_offset` column.  
6. Add `score_table_version` FK constraint pointing at `scoring_model_versions(version)`. Pre-condition: every existing `score_table_version` value MUST correspond to an existing row in `scoring_model_versions`. If migration runs before V4.3's `scoring_model_versions` table is created, this step BLOCKS. Coordination with 04B deploy is required: V4.3's `scoring_model_versions` and the seed row for `v1.0` MUST exist before 04A V2.2 schema migration runs.  
7. Replace `enforce_published_form_immutability()` function with the updated body (drops `form_equating_offset` check; adds three override-column checks; intentionally omits `is_selectable` and `retired_for_new_sessions_at` since they are post-publish operational toggles).  
8. Create `enforce_form_publish_gate()` function and `trg_form_publish_gate` BEFORE UPDATE trigger (§6.2).

Existing draft forms with `form_equating_offset != 0` lose that value; this is acceptable because Parent V3.0 retires the concept entirely (no Layer 3 in v1.0 scoring). Published forms in production at the time of migration: there should be none at MVP launch, but if any exist with non-zero offsets, they need to be archived and republished against the new schema with content-team review.

**Admin FK dependency (V2.2 lock-cycle MED1).** Step 2's `REFERENCES admins(id)` requires the `admins` table to exist before this migration runs. Doc 01 owns the `admins` table; coordinate with Doc 01's schema deploy.

### **5.2 `test_form_items` (unchanged from V2.1)**

Question membership in a form. One row per question per module bundle.

CREATE TABLE test\_form\_items (  
  id              uuid PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  test\_form\_id    uuid NOT NULL REFERENCES test\_forms(id),  
  section         text NOT NULL CHECK (section IN ('RW', 'M')),  
  module          text NOT NULL CHECK (module IN ('1', '2A', '2B')),  
  ordinal         int  NOT NULL,  
  question\_id     text NOT NULL,            \-- canonical question ID from Doc 02

  UNIQUE (test\_form\_id, section, module, ordinal),  
  UNIQUE (test\_form\_id, question\_id)        \-- a question appears at most once per form  
);

CREATE INDEX idx\_test\_form\_items\_lookup  
  ON test\_form\_items (test\_form\_id, section, module, ordinal);

V4.3 §13 `validate_form_composition()` reads this table to validate module composition at publish time (per §6.4 form-publish handler).

### **5.3 `test_sessions` (unchanged from V2.1)**

The session header. One row per student attempt.

CREATE TABLE test\_sessions (  
  id                       uuid PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  student\_id               uuid NOT NULL,  
  test\_form\_id             uuid NOT NULL REFERENCES test\_forms(id),  
  state                    text NOT NULL CHECK (state IN (  
    'created', 'active', 'section\_break', 'completed',  
    'abandoned\_final', 'partial\_scored\_abandoned'  
  )),  
  mode                     text NOT NULL CHECK (mode IN ('strict', 'lenient')),  
  active\_section           text CHECK (active\_section IN ('RW', 'M')),  
  started\_at               timestamptz,  
  completed\_at             timestamptz,  
  abandoned\_at             timestamptz,  
  grace\_expires\_at         timestamptz NOT NULL,  
  attempt\_number\_for\_form  int  NOT NULL,  
  is\_first\_seen\_form\_attempt boolean NOT NULL,  
  created\_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT started\_state\_has\_started\_at CHECK (  
    (state IN ('active', 'section\_break') AND started\_at IS NOT NULL) OR  
    (state NOT IN ('active', 'section\_break'))  
  ),  
  CONSTRAINT active\_has\_active\_section CHECK (  
    (state \= 'active' AND active\_section IS NOT NULL) OR  
    (state \<\> 'active')  
  ),  
  CONSTRAINT break\_has\_no\_active\_section CHECK (  
    (state \= 'section\_break' AND active\_section IS NULL) OR  
    (state \<\> 'section\_break')  
  ),  
  CONSTRAINT completed\_has\_completion\_time CHECK (  
    (state \= 'completed' AND completed\_at IS NOT NULL) OR  
    (state \<\> 'completed')  
  ),  
  CONSTRAINT abandoned\_has\_abandon\_time CHECK (  
    (state IN ('abandoned\_final', 'partial\_scored\_abandoned') AND abandoned\_at IS NOT NULL) OR  
    (state NOT IN ('abandoned\_final', 'partial\_scored\_abandoned'))  
  )  
);

\-- Enforce one active session per student  
CREATE UNIQUE INDEX one\_active\_session\_per\_student  
  ON test\_sessions (student\_id)  
  WHERE state IN ('created', 'active', 'section\_break');

`client_instance_id` is intentionally NOT on this table. The session is owned by the authenticated student, not by any particular browser tab; multi-tab semantics (§15.3) make a single session-level instance identifier misleading. Instance identifiers travel through per-request audit metadata instead (§15.3).

The `attempt_number_for_form` and `is_first_seen_form_attempt` columns are computed at session-create time:

* `attempt_number_for_form` \= `(count of completed/abandoned sessions for this student + this form) + 1`  
* `is_first_seen_form_attempt` \= `(attempt_number_for_form == 1)`

These values are immutable after row creation. They are runtime-generated data; their interpretation in report copy is owned by 04C.

### **5.4 `test_session_sections` (unchanged from V2.1)**

Per-section state. Two rows per session (RW and M).

CREATE TABLE test\_session\_sections (  
  id                    uuid PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  test\_session\_id       uuid NOT NULL REFERENCES test\_sessions(id),  
  section               text NOT NULL CHECK (section IN ('RW', 'M')),  
  state                 text NOT NULL CHECK (state IN (  
    'not\_started', 'module1\_active', 'module1\_submitted',  
    'module2\_active', 'submitted'  
  )),  
  module2\_path          text CHECK (module2\_path IN ('A', 'B')),  
  module1\_started\_at    timestamptz,  
  module1\_submitted\_at  timestamptz,  
  module1\_submitted\_by  text CHECK (module1\_submitted\_by IN ('student', 'timeout')),  
  module2\_started\_at    timestamptz,  
  module2\_submitted\_at  timestamptz,  
  module2\_submitted\_by  text CHECK (module2\_submitted\_by IN ('student', 'timeout')),  
  module1\_expires\_at    timestamptz,  
  module2\_expires\_at    timestamptz,  
  active\_paused\_ms      bigint NOT NULL DEFAULT 0,  
  last\_active\_at        timestamptz,

  UNIQUE (test\_session\_id, section),

  CONSTRAINT module1\_submission\_metadata CHECK (  
    (state IN ('module1\_submitted', 'module2\_active', 'submitted')  
     AND module1\_submitted\_at IS NOT NULL  
     AND module1\_submitted\_by IS NOT NULL)  
    OR  
    (state NOT IN ('module1\_submitted', 'module2\_active', 'submitted'))  
  ),  
  CONSTRAINT module2\_path\_after\_module1\_submit CHECK (  
    (state IN ('module2\_active', 'submitted') AND module2\_path IS NOT NULL) OR  
    (state NOT IN ('module2\_active', 'submitted'))  
  ),  
  CONSTRAINT module2\_submission\_metadata CHECK (  
    (state \= 'submitted'  
     AND module2\_submitted\_at IS NOT NULL  
     AND module2\_submitted\_by IS NOT NULL)  
    OR  
    (state \<\> 'submitted')  
  )  
);

CREATE INDEX idx\_test\_session\_sections\_lookup  
  ON test\_session\_sections (test\_session\_id, section);

The `module1_submitted_by` and `module2_submitted_by` columns discriminate student-initiated submissions from timeout-driven auto-submissions. The audit trail in 04D consumes these for incident investigation and SLI computation.

The `active_paused_ms` accumulator tracks the cumulative wall-clock duration during which the student was outside the section UI while it was active. In strict mode, the heartbeat handler never writes to it (§8.3 CASE expression). In lenient mode, it accumulates per the §8.2 timer formula.

### **5.5 `test_answer_submissions` (unchanged from V2.1)**

Append-only ledger of every answer submission attempt. One row per submission request. Defined before `test_session_answers` so the canonical answer table can declare its FK inline.

CREATE TABLE test\_answer\_submissions (  
  id                       uuid PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  test\_session\_id          uuid NOT NULL REFERENCES test\_sessions(id),  
  idempotency\_key          text NOT NULL,  
  section                  text NOT NULL CHECK (section IN ('RW', 'M')),  
  module                   text NOT NULL CHECK (module IN ('1', '2A', '2B')),  
  ordinal                  int  NOT NULL,  
  question\_id              text NOT NULL,  
  answer                   text,                       \-- value submitted; NULL \= explicit omit  
  client\_latency\_ms        int,  
  response\_json            jsonb NOT NULL,             \-- full response returned to client  
  response\_schema\_version  text NOT NULL,              \-- e.g., 'tests-answer-v1'; pins replay shape  
  was\_canonical\_update     boolean NOT NULL,           \-- true if this submission updated test\_session\_answers  
  created\_at               timestamptz NOT NULL DEFAULT now(),

  UNIQUE (test\_session\_id, idempotency\_key)  
);

CREATE INDEX idx\_test\_answer\_submissions\_lookup  
  ON test\_answer\_submissions (test\_session\_id, section, module, ordinal, created\_at);

Append-only at the application level. The `(test_session_id, idempotency_key)` unique constraint is the idempotency primitive. `response_schema_version` pins replay shape per V2.1 RB-V21-04.

### **5.6 `test_session_answers` (unchanged from V2.1; reaffirmed contract V2.2)**

Canonical answer state per question. One row per `(test_session_id, section, module, ordinal)` **when an answer was submitted**. Missing rows are valid blanks per invariant \#13.

CREATE TABLE test\_session\_answers (  
  test\_session\_id       uuid NOT NULL REFERENCES test\_sessions(id),  
  section               text NOT NULL CHECK (section IN ('RW', 'M')),  
  module                text NOT NULL CHECK (module IN ('1', '2A', '2B')),  
  ordinal               int  NOT NULL,  
  question\_id           text NOT NULL,  
  answer                text,                       \-- NULL \= explicit omit; absent row \= never submitted  
  client\_latency\_ms     int,                        \-- informational; not used in scoring  
  last\_submission\_id    uuid NOT NULL REFERENCES test\_answer\_submissions(id),  
  updated\_at            timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (test\_session\_id, section, module, ordinal)  
);

CREATE INDEX idx\_test\_session\_answers\_session  
  ON test\_session\_answers (test\_session\_id, section, module);

**V2.2 contract reaffirmation (RB-V22-05):** this table is the canonical answer state. Both 04B (scoring) and Doc 05 (mastery, when drafted) consume from this table directly via JOIN with `test_form_items` and `questions`. 04A MUST NOT publish per-question downstream events. The `last_submission_id` FK enables audit traceback from canonical state to the originating idempotency-keyed submission.

**Important nullability distinction:**

* `answer = NULL` on an existing row: the student explicitly submitted a null/empty answer (they cleared their selection). The submission is recorded; the canonical answer is "explicit blank."  
* No row at all for `(test_session_id, section, module, ordinal)`: the student never submitted anything for this question. 04B's LEFT JOIN treats both cases identically as wrong (per V4.3 §11). The distinction is preserved for audit purposes; scoring does not differentiate.

04A MUST NOT insert placeholder rows with `answer = NULL` for un-submitted questions to "pre-populate" the table. The natural absence of a row is the correct signal.

### **5.7 `exam_runtime_outbox` (unchanged from V2.1)**

Transactional outbox for downstream events.

CREATE TABLE exam\_runtime\_outbox (  
  id                    uuid PRIMARY KEY DEFAULT gen\_random\_uuid(),  
  event\_type            text NOT NULL CHECK (event\_type IN (  
    'test\_session\_completed',  
    'test\_session\_partial\_scored\_abandoned'  
  )),  
  aggregate\_id          uuid NOT NULL,                 \-- typically test\_session\_id  
  payload               jsonb NOT NULL,  
  status                text NOT NULL DEFAULT 'pending'  
                          CHECK (status IN ('pending', 'published', 'failed')),  
  attempts              int  NOT NULL DEFAULT 0,  
  last\_attempt\_at       timestamptz,  
  published\_at          timestamptz,  
  failure\_reason        text,  
  created\_at            timestamptz NOT NULL DEFAULT now()  
);

CREATE INDEX idx\_exam\_runtime\_outbox\_pending  
  ON exam\_runtime\_outbox (created\_at)  
  WHERE status \= 'pending';

**V2.2 reaffirmation (RB-V22-06):** the `event_type` CHECK constraint is the boundary that prevents accidental Doc 05 event introduction. Adding any other event type — `test_question_event`, `test_pass`, `mastery_*`, etc. — would require:

1. A Parent doc revision (the no-emission posture in Parent V3.0 §11.2)  
2. A V4.3-equivalent revision in Doc 05 explaining what events it consumes  
3. A schema migration removing this CHECK constraint

The constraint is intentionally narrow.

**Status semantics:**

* `pending`: row is awaiting first publish OR is in retry-backoff after a transient failure. Ordinary publish failures (network glitch, downstream temporarily unavailable) leave the row in `pending` with incremented `attempts` and a populated `failure_reason`; the worker retries on the next pass.  
* `published`: row was successfully forwarded to the downstream consumer (04B's scoring orchestrator at MVP). Terminal happy state.  
* `failed`: row exhausted its retry budget and is now in **terminal dead-letter state**. A row in `failed` will not be retried by the worker automatically; operational intervention is required to investigate the cause and (if appropriate) reset it to `pending` after fixing the underlying issue. An alert fires when any row reaches `failed`. This status is NOT used for transient errors.

---

## **6\. Form publish contract (V2.2 — NEW)**

This section introduces the form-publish gate that prevents misconfigured forms from being made available for student sessions. It is the runtime-layer enforcement of Parent V3.0 §6 form-publish requirements and 04B V4.3 §13 module composition validation.

### **6.1 Publish lifecycle**

A `test_forms` row progresses through these statuses:

draft → published → archived

* `draft`: form is being authored; content and configuration are mutable; never selectable by a session.  
* `published`: form is immutable per the trigger in §5.1; selectable by `POST /api/tests/sessions`.  
* `archived`: form is removed from selection but its rows remain queryable for historical audit. Sessions bound to an archived form continue to score normally per V4.3 §7.5 historical reproducibility.

The transitions `draft → published` and `published → archived` are one-way. There is no `published → draft` path. To "fix" a published form, archive it and publish a new form (per Parent V3.0 §6).

### **6.2 Publish gate — DB-enforced checks**

The gate is implemented as a `BEFORE UPDATE` trigger on `test_forms` that fires when `status` transitions from `'draft'` to `'published'`. Two checks run; either failure aborts the UPDATE.

CREATE OR REPLACE FUNCTION enforce\_form\_publish\_gate() RETURNS trigger AS $$  
DECLARE  
  v\_version\_status text;  
  v\_within\_range   boolean;  
  v\_override\_set   boolean;  
BEGIN  
  \-- Only fire on the draft → published transition  
  IF NOT (OLD.status \= 'draft' AND NEW.status \= 'published') THEN  
    RETURN NEW;  
  END IF;

  \-- Gate check (a): score\_table\_version exists and is currently active  
  SELECT status INTO v\_version\_status  
    FROM scoring\_model\_versions  
    WHERE version \= NEW.score\_table\_version;

  IF v\_version\_status IS NULL THEN  
    RAISE EXCEPTION 'Cannot publish: score\_table\_version % does not exist in scoring\_model\_versions',  
      NEW.score\_table\_version  
      USING ERRCODE \= 'integrity\_constraint\_violation';  
  END IF;

  IF v\_version\_status \<\> 'active' THEN  
    RAISE EXCEPTION 'Cannot publish: score\_table\_version % is in status % (must be active)',  
      NEW.score\_table\_version, v\_version\_status  
      USING ERRCODE \= 'integrity\_constraint\_violation';  
  END IF;

  \-- Gate check (b): routing thresholds in expected range OR override recorded  
  v\_within\_range :=  
    NEW.routing\_threshold\_rw BETWEEN 18 AND 21  
    AND NEW.routing\_threshold\_m BETWEEN 13 AND 16;

  v\_override\_set :=  
    NEW.routing\_override\_approved\_by IS NOT NULL  
    AND NEW.routing\_override\_reason IS NOT NULL;

  IF NOT (v\_within\_range OR v\_override\_set) THEN  
    RAISE EXCEPTION 'Cannot publish: routing thresholds (RW=%, M=%) outside expected range (RW 18-21, M 13-16) and no override recorded',  
      NEW.routing\_threshold\_rw, NEW.routing\_threshold\_m  
      USING ERRCODE \= 'integrity\_constraint\_violation';  
  END IF;

  RETURN NEW;  
END;  
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg\_form\_publish\_gate  
  BEFORE UPDATE ON test\_forms  
  FOR EACH ROW EXECUTE FUNCTION enforce\_form\_publish\_gate();

Gate check (a) ensures the form binds to a real, currently-active scoring model version. The FK constraint on `score_table_version` already enforces existence; this check additionally enforces `status = 'active'` at publish time.

Gate check (b) ensures routing thresholds are within the expected range derived from documented external research (T\_rw ≈ 18–21 of 27; T\_math ≈ 13–16 of 22 per Parent V3.0 §13 risk \#4), unless a Founder/CTO override is recorded with a justification.

Gate check (c) — module composition — is application-handler-enforced (§6.3), not DB-trigger-enforced, because it requires JOIN traversal across `test_form_items` and `questions` and is best implemented by calling V4.3 §13's `validate_form_composition()` function from the handler.

**Why active only (not active OR superseded):** at publish time, the form is binding for new sessions for the foreseeable future. Binding a fresh form against a superseded version would mean new sessions immediately scoring against a deprecated model — which contradicts the operational intent of versioning. Superseded-version scoring is reserved for sessions already-bound to forms that pre-date a version transition (V4.3 §7.5 historical reproducibility). New forms MUST bind to the current `active` version.

### **6.3 Publish gate — application-handler-enforced check**

The form-publish endpoint (`POST /api/admin/forms/:id/publish`) is owned by **04A runtime/content tooling** (V2.2 lock-cycle BL2). Ownership of its collaborators is explicit:

* **Doc 01** owns the authorization predicate that gates which admin/operator roles may publish forms.  
* **Doc 02 / question metadata** owns the difficulty, section, and skill metadata that `validate_form_composition()` reads (via JOIN with `test_form_items`).  
* **04B V4.3** owns the `validate_form_composition()` function itself (defined in V4.3 §13.2); 04A calls it but does not implement it.  
* **04A** owns the endpoint, the calling sequence below, the DB trigger `enforce_form_publish_gate()`, and the HTTP error contract (§16.2).

The handler MUST run these steps in this order:

1\. Begin transaction.  
2\. Verify the calling actor has form-publish role authorization (Doc 01).  
3\. Read the candidate form row by id.  
4\. Call validate\_form\_composition(form\_id) per V4.3 §13.2.  
   For each returned row where valid \= false:  
     \- Abort with a structured error listing the (section, module, expected, actual) tuple.  
     \- Roll back the transaction. The form remains 'draft'.  
5\. UPDATE test\_forms SET status \= 'published', published\_at \= clock\_timestamp() WHERE id \= form\_id.  
   This triggers enforce\_form\_publish\_gate() which validates check (a) and check (b).  
   If the trigger raises, the UPDATE aborts and the transaction rolls back.  
   (Note: \`clock\_timestamp()\` rather than \`now()\` for consistency with the runtime time-source discipline in §8.1 — V2.2 lock-cycle MED2.)  
6\. Commit transaction. Form is published.

Application-level (step 4\) and DB-trigger-enforced (step 5\) checks together provide the full gate. Splitting the enforcement is deliberate: composition validation requires complex multi-table JOIN logic best expressed as a callable function with structured row output; version status and routing thresholds are single-row checks ideal for trigger-level enforcement.

**Override path for routing thresholds (V2.2 RB-V22-04).** When content team determines that a form's authored routing thresholds need to fall outside the documented expected range (e.g., a form with intentionally higher Module 1 difficulty calibration), the publish handler workflow is:

1\. Content team sets routing\_threshold\_rw / routing\_threshold\_m to the off-spec values on the draft form.  
2\. Content team also sets routing\_override\_approved\_by \= \<Founder or CTO identifier\>  
   and routing\_override\_reason \= \<text justification\>.  
3\. Both override columns MUST be non-null per the override\_pair\_both\_or\_neither CHECK constraint  
   on test\_forms (§5.1).  
4\. Publish handler runs the standard sequence above. Gate check (b) sees v\_override\_set \= true  
   and passes.  
5\. The audit trail records the override approver \+ reason for incident review.

The override mechanism is not a "wave through" — it is an explicit record that someone with role authority approved the deviation, with a justification preserved in the row. 04D audit consumes this metadata.

### **6.4 Module composition validation reference**

V4.3 §13 owns the canonical `validate_form_composition()` function. Lyceon-locked composition (per V4.3 §13.1):

RW M1:   27 items (no fixed difficulty distribution authored at parent level)  
RW M2A:  14 easy, 9 medium, 4 hard  
RW M2B:  4 easy, 9 medium, 14 hard  
Math M1: 7 easy, 9 medium, 6 hard (totaling 22\)  
Math M2A: 11 easy, 8 medium, 3 hard  
Math M2B: 3 easy, 8 medium, 11 hard

The function returns one row per `(section, module)` indicating whether the actual composition matches the expected, plus the JSON-formatted actual and expected counts. The publish handler refuses to publish if any row has `valid = false`.

### **6.5 Post-publish behavior**

Once published:

* `status` cannot transition back to `draft` (no schema path; no application path).  
* Content-bearing columns (per §5.1 immutability trigger) cannot mutate.  
* `is_selectable` and `retired_for_new_sessions_at` are post-publish operational toggles, NOT immutable. They are the mechanism for retiring a form from new selection independent of `archived` status.  
* New sessions created against `POST /api/tests/sessions` with this form's id succeed only when `is_selectable = true` (subject to entitlement and existing-session checks).

**Selectable-vs-scoreable separation (V2.2 lock-cycle BL1).** Form lifecycle has two orthogonal concerns:

| Concern | Field | Locked by |
| ----- | ----- | ----- |
| Can this form be scored at all? | `status = 'published'` AND bound `score_table_version` is `active` or `superseded` (V4.3 §12.1 orchestrator gate) | Schema \+ V4.3 orchestrator |
| Can new sessions select this form? | `is_selectable = true` AND `status = 'published'` | Application layer (§7.3 step 3\) |

These do not move together. A form bound to a `superseded` scoring version remains **scoreable** indefinitely (per V4.3 §7.5 historical reproducibility) but Product/Content MAY choose to flip `is_selectable = false` to stop accepting new sessions against it. The two operations are independent.

**Default behavior on version supersession.** When `scoring_model_versions.version` transitions from `active` to `superseded` (because a future v2.0 activates), 04A does NOT automatically flip `is_selectable` for forms bound to the superseded version. The default is to leave `is_selectable = true` and let Product/Content explicitly retire forms via a runbook procedure. Operations team responsibilities at the version-transition boundary are documented in 04D / Doc 00 runbook material; 04A's schema provides the mechanism.

**Retiring a form from new selection:**

UPDATE test\_forms  
SET is\_selectable \= false,  
    retired\_for\_new\_sessions\_at \= clock\_timestamp()  
WHERE id \= $form\_id;

After retirement:

* Already-running sessions continue normally to completion and scoring (unaffected by the toggle).  
* New `POST /api/tests/sessions` against this form returns `409 form_not_available` (§16.2).  
* The form remains in `status = 'published'` for historical scoring and audit; archiving is a separate decision.

**Bound version at scoring time.** If a form's bound version is ever in an unexpected state at scoring time (V4.3 §19.6 unattested-version path), 04B's orchestrator raises and the session ends in `failed_requires_review` (Parent V3.0 §10.2). 04A does NOT pre-check version status at session-create — the publish-time gate is the canonical enforcement, plus `is_selectable` provides the operational handle for new-session control independent of version state.

---

## **7\. Session lifecycle**

### **7.1 State diagram**

      ┌─────────┐  
        │ created │   (session row exists; no section started)  
        └────┬────┘  
             │ student starts RW Module 1  
             ▼  
        ┌─────────┐  
   ┌────│ active  │────┐  
   │    └────┬────┘    │  
   │   (RW)  │         │  ┌──────────────────────────┐  
   │         │ RW done │  │ partial\_scored\_abandoned │  
   │         ▼         │  │  (past-grace             │  
   │  ┌──────────────┐ │  │  ≥1 section submitted)   │  
   │  │ section\_break│─┘  └──────────────────────────┘  
   │  └──────┬───────┘   ┌──────────────────┐  
   │         │ student   │ abandoned\_final  │  
   │         │ starts M  │ (past-grace      │  
   │         │ Module 1  │  0 sections      │  
   │         ▼           │  submitted)      │  
   │   ┌─────────┐       └──────────────────┘  
   └──▶│ active  │  
       │  (M)    │  
       └────┬────┘  
            │ both sections submitted  
            ▼  
       ┌───────────┐  
       │ completed │  
       └───────────┘

### **7.2 State transitions and triggers**

| From | To | Trigger | Side effects |
| ----- | ----- | ----- | ----- |
| (none) | `created` | `POST /api/tests/sessions` returns successfully | Row inserted; `grace_expires_at` computed; both `test_session_sections` rows inserted with `state='not_started'` |
| `created` | `active` | First module-start request (RW Module 1\) | `started_at` set; `active_section` set to RW; RW section's `module1_started_at` set; `module1_expires_at` set |
| `active` (RW) | `section_break` | RW Module 2 submit (student or timeout) | RW section state goes to `submitted` with `module2_submitted_by` set; `active_section` cleared; suggested break begins (see §9.4 for break behavior) |
| `section_break` | `active` (M) | Math Module 1 start request | `active_section` set to M; Math section's `module1_started_at` set. The break is non-enforced: the student MAY start Math immediately, MAY wait the suggested break duration, or MAY wait longer (up to the test-level grace boundary) |
| `active` (M) | `completed` | Math Module 2 submit (student or timeout) | `completed_at` set; `active_section` cleared; completion outbox event inserted in the same transaction (§13) |
| `active` or `section_break` | `partial_scored_abandoned` | Sweep detects `clock_timestamp() > grace_expires_at` AND at least one section is in state `submitted` | `abandoned_at` set; partial-scored outbox event inserted in the same transaction |
| `active` or `section_break` | `abandoned_final` | Sweep detects `clock_timestamp() > grace_expires_at` AND no section is in state `submitted` | `abandoned_at` set; no outbox event (no scoring runs on this terminal state) |
| `created` | `abandoned_final` | Sweep detects `clock_timestamp() > grace_expires_at` AND no section has started | `abandoned_at` set; no outbox event |

State transitions to `abandoned_final` and `partial_scored_abandoned` are executed exclusively by the abandonment-sweep job (§14). No API endpoint writes these states directly. The API layer rejects requests against past-grace sessions with `409 session_grace_expired`; the sweep finalizes the state in a separate operation.

### **7.3 Session creation**

`POST /api/tests/sessions` request body:

{  
  "test\_form\_id": "uuid",  
  "mode": "strict" | "lenient"  
}

Server steps:

1. Authenticate student session; extract `student_id` from session token.  
2. Verify the student holds an active product entitlement that includes full-length exams (per Doc 01).  
3. Verify `test_form_id` references a row with `status = 'published'` AND `is_selectable = true`. If `status <> 'published'`, return `409 form_not_published`. If `status = 'published'` AND `is_selectable = false` (form has been retired from new selection per §6.5), return `409 form_not_available`.

**Acquire a per-student advisory lock for the duration of the create transaction.** This serializes concurrent session-create requests from the same student so that step 5's history read and step 8's insert see a consistent view. The advisory lock key is a hash of `student_id`; the lock is automatically released at transaction end.  
 SELECT pg\_advisory\_xact\_lock(hashtext('test\_session\_create:' || $student\_id));

4.   
5. Check for an existing non-terminal session for this student (`state IN ('created', 'active', 'section_break')`):  
   * **If one exists and is past-grace** (`clock_timestamp() > grace_expires_at`): finalize it inline by running the abandonment sweep logic (§14.3 steps 2–5) against that single session within the current transaction. The prior session transitions to its terminal state (`abandoned_final` or `partial_scored_abandoned`) before the new-session insert proceeds. This eliminates the wait window between grace expiry and the next scheduled sweep run. Continue to step 6\.  
   * **If one exists, is NOT past-grace, and references the same `test_form_id`:** abort the create and return 200 with the existing session's payload (idempotent return).  
   * **If one exists, is NOT past-grace, and references a different `test_form_id`:** abort the create and return 409 `existing_active_session` with the existing session's identifier.  
   * **If no non-terminal session exists:** continue to step 6\.

Compute `attempt_number_for_form` from history within this same transaction. Because the advisory lock from step 4 serializes concurrent creates for this student, the count is consistent at write time:  
 SELECT COUNT(\*) \+ 1 AS next\_attemptFROM test\_sessionsWHERE student\_id \= $student\_id  AND test\_form\_id \= $test\_form\_id  AND state IN ('completed', 'abandoned\_final', 'partial\_scored\_abandoned');

6.   
7. Set `is_first_seen_form_attempt = (next_attempt == 1)`.  
8. Compute `grace_expires_at = clock_timestamp() + (test_level_grace_window_ms)`. Default 24 hours. Value comes from runtime config and is fixed for the lifetime of this individual session.  
9. Insert `test_sessions` row with `state = 'created'`.  
10. Insert two `test_session_sections` rows (one per section) with `state = 'not_started'`.  
11. Commit the transaction (which also releases the advisory lock).  
12. Return 201 with the full session payload.

If step 5's inline-finalization branch fires, the response 201 indicates the NEW session; the prior session's terminal-state details are visible via a separate state-read on its session ID.

Response body:

{  
  "session\_id": "uuid",  
  "test\_form\_id": "uuid",  
  "state": "created",  
  "mode": "strict" | "lenient",  
  "attempt\_number\_for\_form": 1,  
  "is\_first\_seen\_form\_attempt": true,  
  "grace\_expires\_at": "2026-05-10T12:00:00Z",  
  "sections": \[  
    {"section": "RW", "state": "not\_started"},  
    {"section": "M",  "state": "not\_started"}  
  \]  
}

---

## **8\. Server-authoritative timing**

### **8.1 Time source**

The only time source in the runtime is the server's `clock_timestamp()` in the PostgreSQL session executing the request. Application code reads server time via:

const serverNow \= await db.queryOne\<{ now: Date }\>('SELECT clock\_timestamp() as now');

Application clocks (Node process clock, container clock) are acceptable for non-critical purposes like log timestamps but MUST NOT be used for state decisions. This single-source discipline prevents drift between application servers and the database.

### **8.2 Section timer computation (canonical helper)**

The remaining time for an active section is computed via a single canonical helper used everywhere in this document:

effective\_expires\_at \= module\_expires\_at \+ active\_paused\_ms \+ currently\_paused\_ms  
remaining\_ms         \= max(0, effective\_expires\_at \- clock\_timestamp())

Where:

* `module_expires_at` is set at module-start time as `module_started_at + module_duration_ms`. It is fixed for the lifetime of the module and reads from the section row.  
* `active_paused_ms` is the **persisted** accumulator of pause time from prior browser-close intervals. It reads from the section row.  
* `currently_paused_ms` is **computed at read time**, not stored. It represents pause time that has accrued since the last heartbeat if the student appears to be paused right now (the gap since `last_active_at` exceeds the pause threshold). When the next heartbeat arrives, this value is folded into `active_paused_ms` and reset to 0 (§8.3).

In **strict mode**, both `active_paused_ms` and `currently_paused_ms` are always 0 (§8.3 explains why). The formula reduces to `max(0, module_expires_at - clock_timestamp())`.

In **lenient mode**, pause time extends the effective deadline. The longer a student is paused, the larger `effective_expires_at` becomes, and the longer `remaining_ms` is when they return.

This is the only place this formula appears in the spec. Every reference elsewhere ("compute remaining time," "check if section expired") resolves to this helper.

### **8.3 Activity heartbeat**

The client posts a heartbeat every 5 seconds while the section UI is in the foreground:

`POST /api/tests/sessions/:session_id/sections/:section/heartbeat`

The server updates the section row using a single SQL statement that atomically folds any pending pause into `active_paused_ms` and refreshes `last_active_at`:

UPDATE test\_session\_sections  
SET active\_paused\_ms \= active\_paused\_ms \+ CASE  
  WHEN $mode \= 'lenient'  
   AND last\_active\_at IS NOT NULL  
   AND clock\_timestamp() \- last\_active\_at \> $pause\_threshold\_interval  
  THEN EXTRACT(epoch FROM (clock\_timestamp() \- last\_active\_at)) \* 1000  
  ELSE 0  
END,  
last\_active\_at \= clock\_timestamp()  
WHERE test\_session\_id \= $1 AND section \= $2  
RETURNING active\_paused\_ms;

**Pause detection (lenient mode only):** a section is considered "paused" if `clock_timestamp() - last_active_at > heartbeat_pause_threshold`. The threshold is a runtime config value with a default of 15 seconds (3 × heartbeat interval; tolerates one missed heartbeat plus jitter). Operations may tune it via runtime config without code deploy.

**Strict mode:** the heartbeat updates `last_active_at` for observability, but the CASE expression's `$mode = 'lenient'` guard returns false, so `active_paused_ms` remains 0\. The §8.2 helper then yields `remaining_ms = max(0, module_expires_at - clock_timestamp())`.

### **8.4 Section expiration enforcement**

When an API request arrives for an active session, the precondition checks run in this order:

1. Auth \+ ownership (§16.1 covers preconditions).  
2. API-level grace check: if `state IN ('created', 'active', 'section_break') AND clock_timestamp() > grace_expires_at`, reject with `409 session_grace_expired` (per invariant §4 \#7).  
3. For any request against a session with an active module (`module1_active` or `module2_active` on either section), compute `remaining_ms` for that module via §8.2. If `remaining_ms <= 0`, the module has timed out; the handler MUST execute the timeout path BELOW before deciding how to handle the inbound request.

#### **Module 1 timeout path**

Execute in one transaction:

* Compute Module 1 raw score from stored answers using the shared comparator (§9.1)  
* Apply routing (§9.1) to compute `module2_path`  
* Set section state to `module1_submitted`  
* Set `module1_submitted_at = clock_timestamp()`  
* Set `module1_submitted_by = 'timeout'`  
* Write `module2_path`

After the transaction commits, the inbound request continues:

* If the request targeted Module 1 (answer submit for module='1', module 1 submit, items for module='1'): reject with `409 module_submitted`. The student's UI receives the rejection, refreshes state, and discovers the section is now in `module1_submitted` state ready for Module 2 start.  
* If the request targeted anything else (state read, heartbeat, Module 2 start, items for Module 2): proceed with the request against the post-timeout state. The state read returns the updated section state; the Module 2 start request succeeds normally because the section is now in `module1_submitted` state.

The session does NOT transition to `section_break` at Module 1 timeout for RW. The student is expected to proceed directly to RW Module 2\.

#### **Module 2 timeout path**

Execute in one transaction:

* Set section state to `submitted`  
* Set `module2_submitted_at = clock_timestamp()`  
* Set `module2_submitted_by = 'timeout'`  
* If this is the second section to reach `submitted` (the first section was already `submitted`): also transition the session to `completed`, set `completed_at`, and insert the `exam_runtime_outbox` completion row per §13 in the SAME transaction.

After the transaction commits, the inbound request continues:

* If the request targeted the timed-out Module 2 (answer submit, module 2 submit, items): reject with `409 module_submitted` or `409 session_terminal` depending on whether the session reached `completed`.  
* If the request targeted anything else: proceed against the post-timeout state.

#### **Sweep-driven timeout**

The abandonment sweep (§14) runs the same Module 1 and Module 2 timeout paths for sessions where no inbound request arrives in time. Both inbound-eager and sweep-driven paths produce identical state changes; the only difference is which trigger initiated them.

### **8.5 Module-start timing**

When a student starts a module:

`POST /api/tests/sessions/:session_id/sections/:section/modules/:module/start`

Server steps (in one transaction):

1. Auth \+ ownership \+ grace check (§16.1).  
2. Verify the section/module transition is valid for current state (e.g., starting Module 2 requires Module 1 to be in `submitted` state with a `module2_path` locked).  
3. Set `module1_started_at` (or `module2_started_at`), set `module1_expires_at = module1_started_at + module_duration_ms` (or `module2_expires_at`), set section state to `module1_active` (or `module2_active`), set `last_active_at = clock_timestamp()`.  
4. Return the first question and current section state.

Module duration values come from the form row (`rw_module1_ms`, `m_module2_ms`, etc.) and are fixed for the form. They cannot be changed mid-session.

### **8.6 Mode flag — implementation summary**

The mode flag's complete behavioral footprint (preserved from V2.1 §11):

| Implementation point | Strict | Lenient |
| ----- | ----- | ----- |
| Session-create endpoint | Accepts `mode = 'strict'` | Accepts `mode = 'lenient'` (default) |
| `test_sessions.mode` column | `'strict'` | `'lenient'` |
| Heartbeat handler CASE expression (§8.3) | `$mode = 'lenient'` guard is false → `active_paused_ms` never increments | `$mode = 'lenient'` guard is true → pause accumulator updates |
| §8.2 helper inputs | `active_paused_ms = 0` always; `currently_paused_ms = 0` always | Both can be non-zero |
| §8.2 helper formula (canonical) | Same formula: `effective_expires_at = module_expires_at + active_paused_ms + currently_paused_ms` (with zeros → reduces to `module_expires_at`) | Same formula (with non-zero accumulators → effective deadline extends) |
| Answer submission | Identical | Identical |
| Module submission | Identical | Identical |
| Routing decision | Identical | Identical |
| Abandonment sweep | Identical | Identical |
| Partial scoring rules | Identical | Identical |
| Session state machine | Identical | Identical |
| Reported scores | Identical from identical answers | Identical from identical answers |

The mode flag is read in exactly two places in the runtime: (1) the heartbeat handler's CASE expression that decides whether to fold pause time into `active_paused_ms`, and (2) the §8.2 helper's input values (which depend on the heartbeat handler's writes). Everywhere else, mode is data carried on the session row for downstream consumers.

This is invariant \#11 (§4). It bounds the testable surface for mode-related logic.

---

## **9\. Module 1 → Module 2 routing**

### **9.1 Decision execution**

When Module 1 of a section is submitted (whether by student action via `POST /api/tests/sessions/:session_id/sections/:section/modules/1/submit` or by the timeout path in §8.4):

1. The handler computes Module 1 raw score: count of `test_session_answers` rows where `test_session_id = $session AND section = $section AND module = '1'` whose stored answer matches the question's correct answer. The correctness comparison uses the shared comparator (`is_answer_correct` per V4.3 §10) that 04B's scoring path also uses — a pure function on a question record from Doc 02 and an answer string. This comparator handles question-type-aware comparison (letter equality for multiple-choice; numeric-equivalence for student-produced response). **Missing answer rows count as wrong** (per invariant \#13); the count uses INNER JOIN on actual submissions, equivalent to V4.3 §11's LEFT-JOIN-with-missing-as-wrong because both produce the same Module 1 correct count.  
2. The handler reads the form's routing threshold: `routing_threshold_rw` if section is RW, `routing_threshold_m` if section is M.  
3. The routing decision is computed: `module2_path = (module1_raw >= threshold) ? 'B' : 'A'`.  
4. In one transaction: section state goes to `module1_submitted`, `module2_path` is written, `module1_submitted_at = clock_timestamp()`, `module1_submitted_by` is set to `'student'` or `'timeout'` per the trigger.  
5. For student-initiated submission, the response includes the section's new state but does NOT include the routed path. The student does not know whether they were routed to A (Easy) or B (Hard).

**Important boundary clarification (V2.2 — reviewer mandate 5):** the routing-decision Module 1 raw-score computation is the only correctness math 04A performs. It is required because routing is an immediate runtime decision and cannot wait on 04B. Computing it uses the shared `is_answer_correct` comparator (a single pure function) and a COUNT(...) aggregate. **This does NOT constitute scoring.** 04A produces `module2_path` (an integer routing decision) — it does NOT produce scaled scores, ceilings, deductions, or floors. All scaled-score math lives in 04B V4.3.

### **9.2 Routing immutability**

Once written, `module2_path` is immutable. The schema enforces this via a trigger:

CREATE OR REPLACE FUNCTION enforce\_module2\_path\_immutability() RETURNS trigger AS $$  
BEGIN  
  IF OLD.module2\_path IS NOT NULL  
     AND NEW.module2\_path IS DISTINCT FROM OLD.module2\_path THEN  
    RAISE EXCEPTION 'module2\_path is immutable once set';  
  END IF;  
  RETURN NEW;  
END;  
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg\_module2\_path\_immutability  
  BEFORE UPDATE ON test\_session\_sections  
  FOR EACH ROW EXECUTE FUNCTION enforce\_module2\_path\_immutability();

A resumed session reads the locked `module2_path` and serves the corresponding question bundle (Module 2A items or Module 2B items from `test_form_items`).

### **9.3 Routing visibility (reaffirmed — Parent V3.0 RB-V3-09, §9 \#15; V4.3 §17)**

The routed path is NEVER surfaced to the student in any API response, UI element, or report field. It is captured in `test_session_sections.module2_path` for scoring (04B reads it to apply the correct M2 difficulty distribution) and audit. This decision exists to avoid encouraging students to over-interpret their routing as a performance signal — the routing exists to make scaled scores meaningful, not to be a metric in itself.

Internal API responses (admin, audit) MAY expose `module2_path`. Student-facing and guardian-facing responses MUST NOT. The state-read endpoint (§15.1) surfaces `module2_path_locked: boolean` to indicate whether routing has occurred, but never the path value itself.

V4.3 §17 disclosure doctrine extends this: scaled scores in reports MUST NOT carry phrases that imply path knowledge (e.g., "you were routed to the harder module"). 04C enforces this at report serialization.

### **9.4 Section break behavior**

The `break_duration_ms` column on `test_forms` defines the **suggested** break duration between RW and Math sections (default and recommended value: 10 minutes, matching the real Digital SAT break). When RW completes, the session enters `section_break` state. The client SHOULD render a break countdown using `break_duration_ms`, but the server does NOT enforce a wait.

A student MAY:

* Wait the suggested break duration before starting Math.  
* Start Math earlier (skip the suggested break).  
* Wait longer than the suggested break duration, up to `grace_expires_at`.

The `break_duration_ms` value is informational. No section-state machine transition is gated on a break-timer expiry. The transition out of `section_break` is exclusively driven by the Math Module 1 start request. If the student lingers in `section_break` past `grace_expires_at`, the abandonment sweep finalizes the session per §14.

---

## **10\. Question serving \+ anti-leak projection**

### **10.1 Serving questions during an active module**

`GET /api/tests/sessions/:session_id/sections/:section/modules/:module/items`

Server steps:

1. Auth \+ ownership \+ grace check (§16.1).  
2. Verify the section/module is currently active (`module1_active` or `module2_active` state).  
3. For Module 1: read `test_form_items` where `test_form_id = session.test_form_id`, `section = $section`, `module = '1'`.  
4. For Module 2: read `test_form_items` where `test_form_id = session.test_form_id`, `section = $section`, `module = $section.module2_path` (which is `'2A'` or `'2B'`).  
5. For each item, fetch the canonical question record from Doc 02 and project it to a pre-completion payload (§10.2).  
6. Merge in any existing student answers from `test_session_answers` so the client can render previously-entered selections.  
7. Return the projected items plus current `remaining_ms` per §8.2.

### **10.2 Pre-completion question payload**

This payload is what the client receives during an active section. It is a strict projection of Doc 02's question record:

type ExamQuestionPayload \= {  
  question\_id: string;  
  ordinal: number;  
  question\_type: 'multiple\_choice' | 'student\_produced\_response';  
  stem: string;  
  // For multiple-choice questions; empty for student-produced response questions  
  options: Array\<{ label: 'A' | 'B' | 'C' | 'D'; text: string }\>;  
  assets: Array\<{ type: 'image' | 'passage' | 'chart'; url: string; alt: string }\>;  
  // Existing answer for this session, if any (format per question\_type)  
  current\_answer: string | null;  
};

Fields that MUST NOT appear in this payload under any condition:

* `correct_answer`  
* `correct_variants` (the V4.3 §10 answer set for the comparator)  
* `explanation`  
* `domain`  
* `skill_code`  
* `difficulty`  
* Distractor metadata, option-internal labels, authoring notes  
* Any field from Doc 02 not in the list above

This projection is enforced at the serializer level: a single function reduces a Doc 02 question to an `ExamQuestionPayload`, and the API handler can only return that type. The forbidden fields are stripped, not omitted-by-convention.

**V4.3 §10 anti-leak reaffirmation:** the comparator `is_answer_correct` runs SERVER-SIDE ONLY. Question records carrying `correct_answer` / `correct_variants` are fetched by the server for the purpose of running the comparator during routing (§9.1) and never travel to the client during an active section.

---

## **11\. Answer submission \+ idempotency**

`POST /api/tests/answer`

### **11.1 Answer format compatibility with question types**

The `answer` column on `test_session_answers` and `test_answer_submissions` stores a string whose format depends on the question type as defined by Doc 02:

* **Multiple-choice questions** (used in RW and a subset of Math): the stored answer is a single uppercase letter from the set `{A, B, C, D}`, or `NULL` for explicit omit.  
* **Student-produced response questions** (numeric input, used in a subset of Math per real Digital SAT structure): the stored answer is the raw string the student entered (e.g., `"42"`, `"3.14"`, `"-7/4"`), or `NULL` for explicit omit. Validation, normalization, and equivalence-checking against the correct answer is owned by the scoring path (04B) and the question record (Doc 02), not by this runtime layer.

The runtime layer's responsibility is to faithfully capture and store whatever the student submitted. Format-level validation against question type happens at submission time (§11.2 server step 4 verifies the question exists in the form) but format-level rejection of malformed answers (e.g., a letter response on a numeric question) is deferred to scoring. The reason: the runtime SHOULD NOT discard a student's submission based on its own opinion of validity; it stores the submission and lets 04B's scoring logic determine correctness.

### **11.2 Submission request**

Request body:

{  
  "test\_session\_id": "uuid",  
  "section": "RW" | "M",  
  "module": "1" | "2A" | "2B",  
  "question\_id": "string",  
  "ordinal": 0,  
  "answer": "string | null",  
  "client\_latency\_ms": 0,  
  "idempotency\_key": "string"  
}

The `answer` field is a string in the format defined by the question's type (§11.1). It is nullable to support explicit unanswering (the student clears their selection or input).

Server steps:

1. Auth \+ ownership \+ grace check (§16.1).  
2. Check for an existing row matching `(test_session_id, idempotency_key)` in `test_answer_submissions`:  
   * If found, return the existing row's `response_json` as the response body. No database write. This is the idempotent-replay path.  
   * **Body-mismatch audit (V2.2 lock-cycle HIGH1).** Before returning the stored response, compare the inbound request's `(section, module, question_id, ordinal, answer)` to the stored row's same fields. If any differ, the client is reusing an idempotency key with a different payload — a likely client bug. The server STILL returns the original `response_json` (idempotency contract preserved; canonical state untouched) but additionally emits an `idempotency_body_mismatch` audit event recording the inbound fields vs the stored fields. This is observability, not rejection — the canonical contract for replay is "same key → same response," regardless of inbound body. Do NOT introduce `idempotency_conflict` as a hard rejection unless a future contract revision requires it.  
   * If not found, proceed to step 3\.  
3. Verify session state allows this submission:  
   * Session must be in `active` state.  
   * The specified `(section, module)` must reference a section whose current state is `module1_active` (if `module = '1'`) or `module2_active` (if `module IN ('2A', '2B')`). If the section state does not match, return `409 module_submitted` (per invariant §4 \#6).  
   * For Module 2 submissions, `module` must equal the section's locked `module2_path` (a request to submit Module 2A on a section routed to 2B returns 409 `module_path_mismatch`).  
4. Verify that a row exists in `test_form_items` matching exactly `(test_form_id, section, module, ordinal)` AND that its `question_id` equals the submitted `question_id`. If no such row exists (wrong ordinal, wrong question\_id for the position, or both), reject with `400 invalid_question_for_form`. This rejection is independent of the section/module state checks in step 3 — even an "active" module rejects malformed submissions.  
5. Compute current `remaining_ms` via §8.2. If `remaining_ms <= 0`, execute the timeout path (§8.4) and reject the inbound request with `409 module_submitted`.  
6. Construct the response JSON for this submission. Set `response_schema_version` to the current API version constant (e.g., `'tests-answer-v1'`).  
7. In a single transaction:  
   * Insert a row into `test_answer_submissions` with `was_canonical_update = true`, the constructed `response_json`, the `response_schema_version`, and all submission metadata.  
   * Upsert `test_session_answers` for the natural key `(test_session_id, section, module, ordinal)`: insert if no row exists; update `answer`, `client_latency_ms`, `last_submission_id = NEW submission row id`, `updated_at = clock_timestamp()` if a row exists.  
8. Return the response from step 6, with `response_schema_version` included in the response envelope.

Response body:

{  
  "response\_schema\_version": "tests-answer-v1",  
  "stored": {  
    "question\_id": "string",  
    "ordinal": 0,  
    "answer": "string | null",  
    "submitted\_at": "2026-05-10T12:00:00Z"  
  },  
  "section\_state": {  
    "section": "RW",  
    "state": "module1\_active",  
    "remaining\_ms": 1850000  
  },  
  "idempotent\_replay": false  
}

The `idempotent_replay` field is `true` when step 2 returned an existing row's `response_json` (the present submission was a replay). On replay, the entire response body comes from the stored `response_json`, including the original `submitted_at`, `remaining_ms`, and `response_schema_version`. Clients receiving a replay response read `response_schema_version` to deserialize against the response shape that was in effect at first processing.

### **11.3 Network-partition correctness**

Consider a student who submits answer A with idempotency key K1, then changes to answer B with idempotency key K2, then a delayed retry of the original K1 arrives:

* The K1 submission inserted a row in `test_answer_submissions` with key K1 and `response_json` describing answer A. It also upserted `test_session_answers` to answer A.  
* The K2 submission inserted a row in `test_answer_submissions` with key K2 and `response_json` describing answer B. It updated `test_session_answers` to answer B.  
* The delayed K1 retry hits step 2, finds the K1 row, returns its stored `response_json` describing answer A. **It does not touch `test_session_answers`.** The canonical answer remains B.

The student's intentional change is preserved. The retry returns a consistent (though stale) response that matches what was returned the first time. This is the correctness property that V1's single-table design lost.

---

## **12\. Module submission**

`POST /api/tests/sessions/:session_id/sections/:section/modules/:module/submit`

This is the explicit student-initiated submit for a module. The timeout path (§8.4) executes the same logic without a request.

Server steps:

1. Auth \+ ownership \+ grace check (§16.1).  
2. Verify the section/module is currently active. If the section is in any state where this module is already submitted (`module1_submitted`, `module2_active`, `submitted`), return `409 module_submitted` and include the current section state in the response.  
3. For Module 1: execute the routing logic (§9.1) with `module1_submitted_by = 'student'`.  
4. For Module 2: in one transaction, set section state to `submitted`, set `module2_submitted_at`, set `module2_submitted_by = 'student'`. If this is the second section to reach `submitted`, also execute the completion transition (§13) in the same transaction.  
5. Return updated section state.

**Module 1 re-submit edge case.** Once Module 1 is in `module1_submitted` state, no further answer writes or module-submit requests against Module 1 succeed — the §4 \#6 invariant rejects them. The locked routing decision and locked answer set together define the section's Module 1 contribution to scoring, and neither can be modified after the first successful submit (whether student-initiated or timeout). This bounds the routing-immutability guarantee against any client-side bug or replay.

---

## **13\. Completion \+ outbox event production**

### **13.1 Completion trigger (reviewer mandate 4 — outbox-based completion eventing preserved)**

Per reviewer mandate 4, completion and partial-abandonment continue to flow through `exam_runtime_outbox` (the V2.1 mechanism is preserved entirely; no shift to direct calls, no shift to non-outbox event paths, no shift to per-question fan-out). The two `event_type` values in §5.7 (`test_session_completed`, `test_session_partial_scored_abandoned`) ARE the complete set of state-change events 04A emits.

Completion happens automatically when both sections reach state `submitted`. The Module 2 submit handler for the second section (or the timeout handler that auto-submits Module 2\) executes the following inside a single database transaction:

1. Transition the section state from `module2_active` to `submitted`; set `module2_submitted_at` and `module2_submitted_by`.  
2. Transition the session state from `active` to `completed`; set `completed_at`.  
3. Insert a row into `exam_runtime_outbox` with `event_type = 'test_session_completed'`, `aggregate_id = test_session_id`, and `payload` containing the session summary needed for scoring (per §13.2).  
4. Commit.

### **13.2 Outbox payload contract**

The `payload` JSON column of the completion outbox row carries the data 04B's scoring orchestrator needs to begin scoring. 04A's contract:

{  
  "test\_session\_id": "uuid",  
  "test\_form\_id": "uuid",  
  "score\_table\_version": "v1.0",  
  "student\_id": "uuid",  
  "mode": "strict" | "lenient",  
  "is\_first\_seen\_form\_attempt": true,  
  "attempt\_number\_for\_form": 1,  
  "completed\_at": "2026-05-10T12:00:00Z",  
  "sections": \[  
    { "section": "RW", "module2\_path": "A" | "B" },  
    { "section": "M",  "module2\_path": "A" | "B" }  
  \]  
}

Notes:

* `score_table_version` is duplicated into the payload from the form row so the consumer doesn't need to re-fetch the form. 04B's orchestrator can still re-fetch for validation but the eager-include keeps the consumer self-contained.  
* Per-answer data is NOT in the payload — 04B reads `test_session_answers` directly via its own JOIN per V4.3 §11. The outbox is a notification, not a data transport.  
* `module2_path` per section is included so 04B can apply the correct M2 difficulty distribution per V4.3 §6.

### **13.3 Atomicity guarantee**

The transaction's atomicity guarantees: the session is never observable in `completed` state without a corresponding outbox row. If the transaction fails (commit error, constraint violation), nothing is written; the request fails; the client retries; idempotency ensures the retry produces the same state.

The outbox publisher worker (§5.7) reads the pending outbox row and publishes the completion event to the scoring pipeline. If publish fails, the worker retries with backoff. The outbox row remains `pending` until the downstream publish succeeds, then transitions to `published`.

The scoring pipeline's idempotency contract (defined by 04B V4.3 §12 via `score_run_event_ledger`) ensures that duplicate `test_session_completed` events for the same `aggregate_id` produce one `score_runs` row, not multiple. This is what allows the outbox publisher to retry safely.

### **13.4 Review unlock dependency (Parent V3.0 §9 \#9 — reaffirmed)**

04A's completion handler does NOT unlock review mode. The dependency chain is:

04A writes completion outbox row  
    ↓  
04B orchestrator consumes outbox event, validates version (V4.3 §12.1 gate),  
    computes scaled scores, inserts score\_runs row  
    ↓  
04C report endpoint reads score\_runs; if present and successful, unlocks review

If 04B fails permanently (V4.3 §19.6 unattested-version path, or other V4.3 §19 hard failure), no `score_runs` row is written; 04C reads from 04D's failure ledger / incident metadata and surfaces `failed_requires_review` per Parent V3.0 §10.2. 04A's state remains `completed` regardless.

### **13.5 No mastery emission (Parent V3.0 RB-V3-07 — reaffirmed)**

04A's completion handler emits exactly the `test_session_completed` outbox row. It does NOT emit any per-question events, mastery events, or fan-out to Doc 05\. Doc 05 (when drafted) consumes `test_session_answers JOIN questions` directly per Parent V3.0 §11.2.

The runtime contract Doc 05 reads from is preserved by invariants \#13 and \#14 (§4): missing rows are valid blanks; canonical answer state is the sole downstream contract.

---

## **14\. Abandonment \+ partial-scoring triggers**

### **14.1 Test-level grace window**

`grace_expires_at` is set at session-create time to `created_at + test_level_grace_window_ms`. The default window is 24 hours; the value is configurable via runtime config and is fixed for the lifetime of an individual session.

If `clock_timestamp() > grace_expires_at` and the session is in any non-terminal state, the session is past-grace. Two enforcement paths interact:

* **API-level enforcement (invariant §4 \#7):** any session-bound request against a past-grace non-terminal session returns `409 session_grace_expired` and performs no state mutation. This prevents continued active interaction past the grace boundary.  
* **Sweep-level enforcement (§14.3):** the sweep job transitions past-grace non-terminal sessions to their appropriate terminal state. The sweep is the only writer of `abandoned_final` and `partial_scored_abandoned`.

A past-grace session may exist briefly between the moment `clock_timestamp() > grace_expires_at` becomes true and the moment the sweep finalizes the state. During that window, API requests return `session_grace_expired` and the session is effectively quarantined.

### **14.2 Section-level pause and resume**

In lenient mode, a student can leave the section UI and return within the test-level grace window. The section timer is paused (per §8.3) while they are away; on return, the timer resumes.

In strict mode, the section timer runs continuously regardless of whether the student is in the UI. A student who closes their browser mid-section returns to a section that has lost real wall-clock time from its timer.

In both modes, the test-level grace window (`grace_expires_at`) is a separate boundary that supersedes section-level behavior. Once past-grace, no API requests succeed regardless of section state.

### **14.3 Abandonment sweep job**

A scheduled job runs every 5 minutes:

\-- Find sessions ready for abandonment transition  
SELECT id, state FROM test\_sessions  
WHERE state IN ('created', 'active', 'section\_break')  
  AND clock\_timestamp() \> grace\_expires\_at  
LIMIT 100  
FOR UPDATE SKIP LOCKED;

For each row returned, the job:

1. Reads the session's section states.  
2. For any section in `module1_active` state: execute Module 1 timeout per §8.4 (auto-submit \+ route \+ write `module1_submitted_by = 'timeout'`). This produces a section in `module1_submitted` state. The sweep does NOT advance the section to `module2_active` because the student is by definition past-grace and will not be returning.  
3. For any section in `module2_active` state: execute Module 2 timeout per §8.4 (auto-submit \+ write `module2_submitted_by = 'timeout'`). This produces a section in `submitted` state.  
4. Determine the abandonment terminal state:  
   * If at least one section ends in `submitted` state (whether student-submitted or timeout-submitted): target state is `partial_scored_abandoned`.  
   * Otherwise: target state is `abandoned_final`.  
5. In one transaction: transition the session to the target state, set `abandoned_at = clock_timestamp()`. If the target is `partial_scored_abandoned`, also insert an `exam_runtime_outbox` row with `event_type = 'test_session_partial_scored_abandoned'` and a payload identifying which sections have submitted answers eligible for scoring (per §14.4).

The `FOR UPDATE SKIP LOCKED` clause ensures concurrent sweep workers don't double-process. The `LIMIT 100` keeps each batch bounded.

### **14.4 Partial-scoring outbox payload contract**

The `payload` JSON for `test_session_partial_scored_abandoned`:

{  
  "test\_session\_id": "uuid",  
  "test\_form\_id": "uuid",  
  "score\_table\_version": "v1.0",  
  "student\_id": "uuid",  
  "mode": "strict" | "lenient",  
  "is\_first\_seen\_form\_attempt": true,  
  "attempt\_number\_for\_form": 1,  
  "abandoned\_at": "2026-05-10T12:00:00Z",  
  "sections": \[  
    { "section": "RW", "section\_state": "submitted",         "module2\_path": "A" | "B",   "scoreable": true  },  
    { "section": "M",  "section\_state": "module1\_submitted", "module2\_path": "A" | "B",   "scoreable": false }  
  \]  
}

`section_state` per section identifies the actual terminal section state. `scoreable: true` is set only when `section_state = 'submitted'` (per invariant \#16: partial scoring eligibility requires Module 2 submitted). Sections that ended in any other state — including `module1_submitted` (Module 1 routed but Module 2 never reached submitted) — are flagged `scoreable: false`.

04B's orchestrator inspects `scoreable` per section and scores only `scoreable: true` sections per V4.3 §15.2. Non-scoreable sections produce NULL columns in `score_runs` and `total_scaled = NULL` per V4.3 §9.1.

**Why `module1_submitted` is not scoreable (BL4 clarification).** Routing locks a Module 2 path at Module 1 submission, but the locked path does NOT mean Module 2 was attempted. Scoring a section based only on Module 1 answers would require a separate "Module 1 only" scoring path in 04B, which V4.3 does not provide and Parent V3.0 does not commission. The clean rule is: a section produces a partial score only after Module 2 reaches `submitted` (whether by student submit or by Module 2 timeout, both of which write at least zero answers to Module 2 and produce a complete two-module input to V4.3's scoring formula).

**Sweep classification edge case (V2.2 lock-cycle BL4 clarification).** Per §14.3 step 4, the sweep classifies a session as `partial_scored_abandoned` if at least one section ends in `submitted` state. A session abandoned with BOTH sections in `module1_submitted` (Module 1 timeout fired on both, Module 2 never started on either) ends as `abandoned_final` — no scoreable section means no outbox event and no `score_runs` row.

### **14.5 Terminal state semantics**

A session in `partial_scored_abandoned` or `abandoned_final` state is terminal. A student cannot resume it; they must start a new session (which becomes a new attempt with `attempt_number_for_form` incremented).

### **14.6 Why the sweep job is the only writer of abandonment terminal states**

No API endpoint transitions a session to `abandoned_final` or `partial_scored_abandoned`. This is deliberate:

* It centralizes the abandonment logic in one place.  
* It prevents race conditions where the student is "in the middle of" a request when the grace window expires.  
* It ensures the abandonment decision is made against the server's `clock_timestamp()` at the sweep moment, after all in-flight requests have either succeeded (pre-grace) or been rejected (post-grace).

The combination of API-level grace enforcement (invariant §4 \#7) and sweep-level state transition produces a clean separation: the API guarantees no work happens against past-grace sessions; the sweep guarantees those sessions reach terminal state deterministically within the sweep cadence (\~5 minutes).

---

## **15\. Resume behavior**

A student can return to a session at any point while it remains in a non-terminal state AND is not past-grace.

### **15.1 Resume request**

`GET /api/tests/sessions/:session_id/state`

Server steps:

1. Auth \+ ownership \+ grace check (§16.1).  
2. Read the session row.  
3. Read both section rows.  
4. If the session is `active`, compute the active section's current `remaining_ms` via §8.2 (this also updates the pause accumulator in lenient mode per §8.3).  
5. Return the full session state.

Response body:

{  
  "session\_id": "uuid",  
  "state": "active" | "section\_break" | "completed" | "...",  
  "mode": "strict" | "lenient",  
  "active\_section": "RW" | "M" | null,  
  "grace\_expires\_at": "2026-05-10T12:00:00Z",  
  "attempt\_number\_for\_form": 1,  
  "is\_first\_seen\_form\_attempt": true,  
  "sections": \[  
    {  
      "section": "RW",  
      "state": "module1\_active",  
      "remaining\_ms": 1850000,  
      "module2\_path\_locked": false  
    },  
    {  
      "section": "M",  
      "state": "not\_started",  
      "remaining\_ms": null,  
      "module2\_path\_locked": false  
    }  
  \]  
}

`module2_path_locked` is `true` once Module 1 of that section has been submitted, but the path itself is not exposed (§9.3).

### **15.2 Resume after section timeout while away**

A subtle case: a student is in `module1_active` for RW, closes their browser, and returns 90 minutes later (longer than the 32-minute Module 1 duration). What happens?

* **Lenient mode:** the section's `last_active_at` is roughly 90 minutes old. The pause-detection logic adds \~90 minutes to `active_paused_ms`. The remaining time is recomputed via §8.2 and is approximately what it was before browser-close (minus the few seconds before the last heartbeat). The student resumes with most of their Module 1 time intact.  
* **Strict mode:** `active_paused_ms` remains 0\. `remaining_ms` via §8.2 is `max(0, module1_expires_at - clock_timestamp())` which is 0\. The next request invokes the §8.4 timeout path: Module 1 auto-submits with `submitted_by = 'timeout'`, routing computes against whatever answers were stored before browser-close, and the section transitions to `module1_submitted`. The student can then start Module 2 normally.

A strict-mode student who walks away mid-section loses that section's remaining time but does not lose the section entirely. This is by design — strict mode simulates test-day conditions where a closed browser is equivalent to walking out of the test center, but the student is still permitted to continue the test from where they would have been forced to move on.

### **15.3 Multi-tab \+ per-request audit metadata**

The session row does NOT carry a `client_instance_id` column. Multi-tab semantics make a single session-level instance identifier misleading: which tab "owns" the session?

Instead, every state-mutating request MAY include a per-request audit metadata block in its body:

{  
  "...request fields...": "...",  
  "audit\_meta": {  
    "client\_instance\_id": "uuid",  
    "user\_agent\_hash": "string"  
  }  
}

The server records this metadata against the resulting row in `test_answer_submissions` (or an equivalent audit log row for other endpoints). This produces a per-submission trail of which client instance produced which write, without requiring the session row to choose a single instance.

If the student has multiple tabs open simultaneously, both can receive valid responses and both can submit answers. The idempotency contract (§11) ensures the same answer isn't double-stored. Conflicting answers from concurrent tabs to the same question are resolved by **successful transaction commit order**: the second commit's `UPSERT` on `test_session_answers` wins, setting `last_submission_id` to its own submission row. For audit sorting of two writes whose `updated_at` could be identical at millisecond resolution, use the tie-breaker chain `test_answer_submissions.created_at`, then `test_answer_submissions.id` (UUID lexicographic order), with the canonical winner identified through `test_session_answers.last_submission_id` (V2.2 lock-cycle HIGH2).

A "soft" notification pattern is recommended in the client: if a tab receives a session-state response showing answers it didn't submit, it SHOULD refresh its view. This is a UX consideration, not a runtime invariant.

---

## **16\. Runtime API surface**

| Method | Path | Purpose |
| ----- | ----- | ----- |
| `POST` | `/api/tests/sessions` | Create a new session, or return existing non-terminal session if one exists |
| `GET` | `/api/tests/sessions/:session_id/state` | Read full session state including remaining time per active module |
| `POST` | `/api/tests/sessions/:session_id/sections/:section/modules/:module/start` | Start a module (RW M1, RW M2, M M1, or M M2) |
| `GET` | `/api/tests/sessions/:session_id/sections/:section/modules/:module/items` | Read the question items for an active module |
| `POST` | `/api/tests/answer` | Submit a single answer (idempotent via `idempotency_key`) |
| `POST` | `/api/tests/sessions/:session_id/sections/:section/modules/:module/submit` | Submit a module (Module 1 → routing; Module 2 → section complete) |
| `POST` | `/api/tests/sessions/:session_id/sections/:section/heartbeat` | Activity heartbeat for pause detection in lenient mode |

The form-publish endpoint (`POST /api/admin/forms/:id/publish`) is an admin-only endpoint owned by content tooling, not enumerated above as a student-facing endpoint. Its behavior is specified in §6.3 publish-handler steps.

### **16.1 Standard precondition checks**

Every session-bound endpoint runs the following checks in order, before any state mutation:

1. **Authentication.** Verify the request carries a valid Doc 01 authenticated session token. Fail → `401 unauthenticated`.  
2. **Entitlement.** Verify the authenticated student holds an active product entitlement that includes full-length exams (per Doc 01). Fail → `403 forbidden`.  
3. **Session existence and ownership.** Read the session row by `session_id`. Fail (not found) → `404 session_not_found`. Verify `session.student_id` matches the authenticated student. Fail → `403 forbidden`.  
4. **Terminal state check.** If `session.state IN ('completed', 'abandoned_final', 'partial_scored_abandoned')`, return `409 session_terminal`.  
5. **API-level grace check (invariant §4 \#7).** If `session.state IN ('created', 'active', 'section_break')` AND `clock_timestamp() > session.grace_expires_at`, return `409 session_grace_expired`.

After these checks pass, endpoint-specific logic runs. Steps 1–3 use cached session data where possible (request authenticator runs once); step 5 always re-evaluates `clock_timestamp()` because it can change between request batches.

### **16.2 Standard error codes**

| Code | HTTP | When |
| ----- | ----- | ----- |
| `unauthenticated` | 401 | No valid session token |
| `forbidden` | 403 | Authenticated, but no entitlement or not the session owner |
| `form_not_published` | 409 | Tried to start a session against a draft or archived form |
| `existing_active_session` | 409 | Student has a non-terminal session against a different form |
| `session_not_found` | 404 | Session ID does not exist |
| `session_terminal` | 409 | Session is in a terminal state and cannot accept the requested action |
| `session_grace_expired` | 409 | Session is non-terminal but past `grace_expires_at`; sweep will finalize |
| `module_submitted` | 409 | Targeted module is no longer active (submitted by student, timeout, or both) |
| `module_path_mismatch` | 409 | Submitted Module 2A on a section routed to 2B (or vice versa) |
| `invalid_question_for_form` | 400 | Submitted `(question_id, ordinal)` does not match any row in `test_form_items` for the active form/section/module (per §11.2 step 4\) |
| `form_not_available` | 409 | Form is `published` but `is_selectable = false` (retired from new selection per §6.5); already-running sessions are unaffected (V2.2 lock-cycle BL1) |
| `invalid_form_publish_config` | 409 | Form-publish gate (§6.2) raised an expected validation failure during `POST /api/admin/forms/:id/publish`. The response carries a structured `subcode` and `details`; see §16.3 for subcode enum (V2.2 lock-cycle BL3). |
| `idempotency_conflict` | 409 | Reserved for future strictness; currently unused (replays return existing response) |

### **16.3 Publish-gate failure subcodes (V2.2 lock-cycle BL3)**

`POST /api/admin/forms/:id/publish` returns `409 invalid_form_publish_config` for all publish-gate validation failures, with a structured response body:

{  
  "error": {  
    "code": "invalid\_form\_publish\_config",  
    "subcode": "score\_table\_version\_not\_active" | "score\_table\_version\_not\_found" | "routing\_threshold\_override\_required" | "invalid\_form\_composition",  
    "details": { ... subcode-specific structure ... }  
  }  
}

| Subcode | When | Details payload |
| ----- | ----- | ----- |
| `score_table_version_not_found` | `enforce_form_publish_gate()` finds no row in `scoring_model_versions` matching the form's `score_table_version` | `{ "version": "v1.0" }` |
| `score_table_version_not_active` | Version exists but `status <> 'active'` at publish time | `{ "version": "v1.0", "current_status": "candidate" | "superseded" }` |
| `routing_threshold_override_required` | Thresholds outside expected range (T\_rw ∉ \[18,21\] OR T\_m ∉ \[13,16\]) and override columns are NULL | `{ "routing_threshold_rw": 22, "routing_threshold_m": 14, "expected_rw_range": [18, 21], "expected_m_range": [13, 16] }` |
| `invalid_form_composition` | Application handler's call to `validate_form_composition()` returned at least one row with `valid = false` (§6.3 step 4\) | `{ "violations": [ { "section": "RW", "module": "2A", "expected": {...}, "actual": {...} } ] }` |

The DB trigger raises with `ERRCODE = 'integrity_constraint_violation'` (PostgreSQL convention for `enforce_form_publish_gate()` failures); the application layer catches this exception, classifies by the exception message into one of the subcodes above, and returns HTTP 409 with the structured response. **HTTP 500 is reserved for unexpected internal errors and is NOT used for normal publish-gate validation rejections.**

---

## **17\. Failure modes**

| Failure | Handling |
| ----- | ----- |
| Network loss mid-submission | Client retries with same `idempotency_key`; server returns stored `response_json` from `test_answer_submissions`; canonical state untouched |
| Browser refresh mid-section | Client re-issues `GET /state`; server returns current state; client renders; no answer loss |
| Multiple browser tabs | Both tabs can interact; idempotency \+ commit-order resolution on `test_session_answers` resolves conflicts; tie-breaker chain is `test_answer_submissions.created_at` then `id` (per §15.3, V2.2 lock-cycle HIGH2) |
| Section timer expires while student offline (strict) | On next request, the §8.4 timeout path executes (Module 1 → auto-route, Module 2 → auto-submit). If the request targeted the timed-out module, it is rejected with `409 module_submitted`; otherwise it proceeds against post-timeout state |
| Section timer expires while student offline (lenient) | On next request, pause accumulator absorbs the gap; section timer effectively paused; no timeout |
| Student never returns within grace window | API-level grace check rejects any incoming requests with `409 session_grace_expired`; sweep finalizes the session to `abandoned_final` (no sections submitted) or `partial_scored_abandoned` (≥1 section submitted) |
| Concurrent answer submissions to same question | Both succeed at the idempotency level (two distinct `idempotency_key` values produce two distinct submission rows); both succeed at the canonical level via successful transaction commit order on `test_session_answers`; canonical winner identified via `test_session_answers.last_submission_id`; for audit reconstruction the tie-breaker chain is `test_answer_submissions.created_at` then `id` (per §15.3, V2.2 lock-cycle HIGH2) |
| Concurrent module submissions | First wins; second sees post-submit state and returns `409 module_submitted` |
| Database transient failure during state transition | Transaction rolls back; client sees 500; retry produces same result via idempotency |
| Form archived mid-session | No effect on active sessions; form-archive operations check for active sessions and warn but do not block |
| Form-publish attempted against non-active scoring version | §6.2 gate raises; application layer returns `409 invalid_form_publish_config` with subcode `score_table_version_not_active` or `score_table_version_not_found` (§16.3); publish UPDATE aborts; form remains `draft`; content team must fix the version reference or wait for the candidate version to activate |
| Form-publish attempted with thresholds outside range and no override | §6.2 gate raises; application layer returns `409 invalid_form_publish_config` with subcode `routing_threshold_override_required`; publish UPDATE aborts; content team must either adjust thresholds or record a Founder/CTO override |
| Form-publish attempted with off-spec module composition | §6.3 application handler refuses (calls `validate_form_composition()`; if any row reports invalid, returns `409 invalid_form_publish_config` with subcode `invalid_form_composition`); form remains `draft`; content team must fix item assignments to match locked composition |
| Bound `scoring_model_versions` version transitions to `superseded` mid-session | No effect on the running session; the session completes against the historical version per V4.3 §7.5; 04B's orchestrator gate (V4.3 §12.1) permits scoring against `active` or `superseded` |
| Bound version is somehow missing/candidate/unattested at scoring time | 04B's orchestrator raises `integrity_constraint_violation` per V4.3 §19.6; no `score_runs` row written; 04C surfaces `failed_requires_review` per Parent V3.0 §10.2; 04A's `test_sessions.state` remains `completed` |
| Question record violates Doc 02 immutability post-publish | Treat as Doc 02 contract violation. Block serving the affected question (return `500 question_integrity_violation` from the items endpoint). Page ops immediately. Do not surface mutated question content to the student under any circumstance |
| Server clock skew between application servers | Mitigated by sourcing time exclusively from PostgreSQL's `clock_timestamp()` rather than application clocks |
| Outbox publisher worker offline | Outbox rows accumulate with `status = 'pending'`; downstream consumers (04B) do not receive events; alert fires when oldest pending row exceeds threshold; worker restart resumes publishing in `created_at` order |
| Downstream consumer (04B) rejects a published event | Worker increments `attempts`, sets `failure_reason`, leaves status `pending`; exponential backoff retries; if `attempts` exceeds threshold, status moves to `failed` and an operational alert fires |
| Doc 05 (when drafted) consumer lags behind canonical state | No effect on 04A — Doc 05's consumer pattern is its own concern. 04A's invariant \#14 guarantees the data is queryable; Doc 05 catches up at its own pace. |

---

## **18\. Transaction boundaries**

The following operations MUST execute as single database transactions. Each row lists the participating writes; all succeed or all roll back.

| Operation | Participating writes | Failure semantics |
| ----- | ----- | ----- |
| Form publish (V2.2 — NEW per RB-V22-03) | Application handler begins txn; calls `validate_form_composition()`; UPDATE `test_forms` SET status='published', published\_at=clock\_timestamp() (which fires `enforce_form_publish_gate()` trigger validating version status and routing thresholds); commit | All checks succeed or the UPDATE aborts; form remains `draft` on failure; no partial-publish state; on failure the application layer returns `409 invalid_form_publish_config` with structured subcode per §16.3 (V2.2 lock-cycle BL3 \+ MED2) |
| Session create | Acquire per-student advisory lock; if existing past-grace session: execute its abandonment finalization (§14.3 steps 2–5); insert `test_sessions`; insert two `test_session_sections` rows (RW \+ M, both `not_started`); release lock at commit | All writes in one transaction; the advisory lock serializes concurrent creates from the same student so `attempt_number_for_form` is consistent; inline-finalized prior sessions reach terminal state atomically with the new session insert |
| Module start | Update `test_session_sections` (set `*_started_at`, `*_expires_at`, state, `last_active_at`) | Single-row update; trivially atomic |
| Heartbeat | Update `test_session_sections` (set `active_paused_ms`, `last_active_at` via §8.3 CASE expression) | Single-row update; trivially atomic |
| Answer submit (new) | Insert `test_answer_submissions`; upsert `test_session_answers` | Either both writes succeed or neither does; idempotency key uniqueness on submissions table guarantees no double-insert on retry |
| Answer submit (replay) | Read `test_answer_submissions` row; no writes | Read-only; no atomicity concern |
| Module 1 submit (student or timeout) | Update `test_session_sections` (state → `module1_submitted`, `module2_path` written, `module1_submitted_at`, `module1_submitted_by`) | Single-row update; trigger enforces `module2_path` immutability |
| Module 2 submit / completion | Update `test_session_sections` (state → `submitted`, `module2_submitted_at`, `module2_submitted_by`); if last section: update `test_sessions` (state → `completed`, `completed_at`); insert `exam_runtime_outbox` row | All writes in one transaction; outbox row is never inserted without the corresponding state change, and the state change is never observable without a corresponding outbox row |
| Abandonment finalization (per session) | Execute any pending module timeouts (per §14.3 steps 2–3); update `test_sessions` (state → terminal, `abandoned_at`); insert `exam_runtime_outbox` row if target is `partial_scored_abandoned` | All writes per session in one transaction; sweep job iterates one session per transaction so partial sweep failures only affect uncommitted sessions |
| Outbox publish | Update `exam_runtime_outbox` (status → `published`, `published_at`) after successful downstream publish | Single-row update; if downstream publish succeeds but the status update fails, the publisher MUST be able to handle re-publishing the same event (downstream idempotency contract per 04B V4.3 §12) |

---

## **19\. Acceptance criteria**

This document is satisfied when:

1. The state machine in §7 is implemented and exhaustively tested for every transition and every edge case in §17.  
2. The §8.2 canonical timer helper produces correct `remaining_ms` values for strict and lenient mode under concurrent heartbeats, browser closes, and resume scenarios.  
3. The §9 routing decision is verifiably immutable post-Module-1-submit (schema trigger enforces it) and is never surfaced in student-facing responses.  
4. The §10.2 pre-completion payload projection demonstrably excludes the forbidden Doc 02 fields (including the V4.3 §10 `correct_variants`) under every code path that serves a question to a student.  
5. The §11 idempotency contract holds under partition/replay scenarios: same `idempotency_key` always returns the same `response_json` regardless of intervening state changes; delayed retries with stale keys never overwrite canonical state set by later submissions with different keys.  
6. The §9.1 \+ §8.4 Module 1 timeout produces the same routing decision as student-initiated submit given the same stored answers, and writes `module1_submitted_by = 'timeout'`.  
7. The §14 abandonment sweep correctly transitions sessions across the grace boundary and correctly classifies them as `abandoned_final` or `partial_scored_abandoned` based on submitted-section count.  
8. The §16.1 standard precondition checks reject past-grace requests with `409 session_grace_expired` before any state mutation.  
9. The §13 completion path inserts the outbox row in the same transaction as the state change, and the publisher worker successfully forwards events to the scoring pipeline with at-least-once delivery semantics.  
10. The §15 resume behavior returns identical state for the same session given the same server clock, regardless of how many times the resume endpoint is called or from how many client instances.  
11. The §8.6 mode flag's behavioral footprint is exactly the two implementation points listed; no other code branches on mode.  
12. The §18 transaction boundaries are respected: no operation in the listed set commits partial state.  
13. **The §6 form-publish gate is verifiably enforced (V2.2 — NEW per RB-V22-03):**  
    * Forms cannot transition `draft → published` while their `score_table_version` references a non-existent or non-`active` row in `scoring_model_versions`  
    * Forms cannot transition `draft → published` with off-range routing thresholds unless `routing_override_approved_by` and `routing_override_reason` are non-null  
    * Forms cannot transition `draft → published` with off-spec module composition (publish handler refuses via `validate_form_composition()`)  
14. **The §13.5 \+ §3.1 no-mastery-emission posture holds (V2.2 — NEW per RB-V22-06):** the `exam_runtime_outbox.event_type` CHECK constraint is the only allowable list (`test_session_completed`, `test_session_partial_scored_abandoned`). No additional event types may be added without Parent V3.0 revision.  
15. **Missing answer rows in `test_session_answers` are valid and correctly handled by downstream consumers (V2.2 — NEW per RB-V22-05):** 04A does not create placeholder rows for un-submitted questions. 04B's LEFT JOIN scoring pattern (V4.3 §11) treats absent rows identically to rows with `answer = NULL` — both count as wrong; both produce the same `score_runs` output. Integration tests verify this equivalence directly: for a fixed answer state, computing scaled scores from `(test_form_items LEFT JOIN test_session_answers)` produces the same scaled score as a control where the equivalent "missing" questions are explicitly inserted with `answer = NULL`.  
16. **Form selectability is independent of form scoreability (V2.2 lock-cycle BL1):** integration tests verify (a) `POST /api/tests/sessions` against a `published` form with `is_selectable = false` returns `409 form_not_available` and no `test_sessions` row is created; (b) an already-running session against a form that is later retired (`is_selectable` flipped to `false`) continues to completion and scoring unaffected; (c) the `retired_implies_not_selectable` CHECK prevents `is_selectable = true` while `retired_for_new_sessions_at IS NOT NULL`.  
17. **Partial scoring eligibility requires Module 2 submitted (V2.2 lock-cycle BL4 per invariant \#16):** integration tests verify (a) a session abandoned with one section in `module1_submitted` and the other in `submitted` reaches `partial_scored_abandoned` and the outbox payload flags the `module1_submitted` section as `scoreable: false`; (b) a session abandoned with both sections in `module1_submitted` reaches `abandoned_final` with no outbox event; (c) a session abandoned with one section in `submitted` and the other untouched reaches `partial_scored_abandoned` with only the submitted section flagged scoreable.  
18. **Publish-gate failures return HTTP 409 with structured subcodes, not HTTP 500 (V2.2 lock-cycle BL3):** integration tests verify that all four §16.3 subcodes (`score_table_version_not_found`, `score_table_version_not_active`, `routing_threshold_override_required`, `invalid_form_composition`) surface as HTTP 409 `invalid_form_publish_config` with the expected `details` payload; the underlying PostgreSQL `integrity_constraint_violation` SQLSTATE is caught and translated by the application layer.

---

## **20\. V2.1 → V2.2 supersession crosswalk**

Each row maps a V2.1 element to its V2.2 disposition.

| V2.1 Element | V2.2 Disposition | Where in V2.2 |
| ----- | ----- | ----- |
| **§Header** "Version: V2.1" | **REPLACED** — V2.2 header; supersedes V2.1 | Header |
| **V2.1 closeout register** (5 V2.0→V2.1 findings) | **CARRIED FORWARD** unchanged for audit history | V2.1 closeout register (this doc) |
| **V2.0 closeout register** (11 V1→V2 findings) | **CARRIED FORWARD** with V2.0/V2.1 → V2.2 section number mapping | V2.0 closeout register (this doc) |
| **§1 (Purpose)** | **REVISED** — explicit Parent V3.0 absorption note; explicit list of what changed | §1 |
| **§2 Hard runtime invariants** (12 invariants) | **REVISED** — preserved \#1–\#12; added \#13 (missing rows are valid blanks), \#14 (canonical answer state contract), \#15 (form-publish gate enforced) | §4 |
| **§3.1 `test_forms`** with `form_equating_offset`, `score_table_version` as plain text | **REVISED** — `form_equating_offset` removed; `score_table_version` is FK to `scoring_model_versions(version)`; new override columns; updated immutability trigger; new migration note 5.1.1 | §5.1 |
| **§3.2 `test_form_items`** | **PRESERVED** unchanged | §5.2 |
| **§3.3 `test_sessions`** | **PRESERVED** unchanged | §5.3 |
| **§3.4 `test_session_sections`** | **PRESERVED** unchanged | §5.4 |
| **§3.5 `test_answer_submissions`** | **PRESERVED** unchanged | §5.5 |
| **§3.6 `test_session_answers`** | **PRESERVED** unchanged; V2.2 adds reaffirmation note clarifying nullability semantics for invariant \#13 | §5.6 |
| **§3.7 `exam_runtime_outbox`** | **PRESERVED** unchanged at the schema level; V2.2 adds reaffirmation that the `event_type` CHECK constraint is the no-mastery-emission boundary | §5.7 |
| **(NEW)** Form publish contract | **NEW** — §6 introduces the publish gate (DB-trigger \+ application-handler split), routing-threshold override mechanism, module-composition validation reference to V4.3 §13, post-publish behavior | §6 |
| **§4 Session lifecycle** (state diagram, transitions, create, completion) | **REVISED** — completion path (V2.1 §4.4) moved to its own §13; otherwise preserved | §7 (lifecycle \+ create), §13 (completion) |
| **§5 Server-authoritative timing** | **PRESERVED** unchanged (with section numbering adjusted) | §8 |
| **§6 Routing** | **PRESERVED** unchanged; V2.2 adds clarification that the routing-decision raw-score computation is the only correctness math 04A performs (reviewer mandate 5\) | §9 |
| **§7.1, §7.2 Question serving \+ payload** | **PRESERVED** — V2.2 adds explicit mention that V4.3 §10 `correct_variants` is also forbidden from the projection | §10 |
| **§7.3 Answer submission** | **PRESERVED** unchanged | §11 |
| **§7.4 Module submission** | **PRESERVED** unchanged | §12 |
| **§4.4 Completion** | **REVISED \+ PROMOTED** — now its own §13 with explicit outbox payload contract, atomicity guarantee, review-unlock dependency note, and no-mastery-emission reaffirmation | §13 |
| **§8 Abandonment \+ partial scoring** | **PRESERVED** unchanged; V2.2 adds explicit partial-scoring outbox payload contract (§14.4) | §14 |
| **§9 Resume behavior** | **PRESERVED** unchanged | §15 |
| **§10 Runtime API surface** | **PRESERVED** unchanged; V2.2 adds note about the admin-only form-publish endpoint (§16) and new error codes (`form_not_available`, `invalid_form_publish_config` with subcodes per §16.3, `invalid_question_for_form`) | §16 |
| **§11 Mode flag — implementation summary** | **PRESERVED** \+ relocated as §8.6 subsection of the timing chapter | §8.6 |
| **§12 Failure modes** | **PRESERVED** \+ augmented with V2.2 form-publish-gate failure rows and superseded-version transition row | §17 |
| **§13 What this document does not specify** | **ABSORBED** into §3 Parent V3.0 inherited constraints \+ §3.6 ownership boundaries | §3 |
| **§14 Acceptance criteria** | **REVISED** — preserved \#1–\#12 (renumbered against §-references); added \#13 (publish gate), \#14 (no mastery emission), \#15 (missing rows handling) | §19 |
| **§15 Transaction boundaries** | **PRESERVED** \+ augmented with form-publish row (new) | §18 |

---

## **21\. Change Records**

| Version | Date | Reviewer | Summary | Source |
| ----- | ----- | ----- | ----- | ----- |
| V1.0 | (historical) | (V1 closeout register in V2.0) | Initial runtime spec | — |
| V2.0 | 2026-04 (approx) | Karl \+ reviewer | 11 V1→V2 findings closed (6 BLOCKER, 5 non-blocking); idempotency split (ledger \+ canonical); API-level grace enforcement; per-section state machine; soft-gate section break; canonical timer helper | V2.0 closeout register |
| V2.1 | 2026-05 (approx) | Karl \+ reviewer | 5 V2.0→V2.1 findings closed (2 BLOCKER, 3 non-blocking); `last_submission_id` FK declared inline; split active/break CHECK constraints; per-student advisory lock for session-create; `response_schema_version` on submission ledger; eager finalization of past-grace prior sessions; clarified outbox `failed` semantics | V2.1 closeout register |
| V2.2 | 2026-05-12 | Karl \+ Claude | Absorbs Parent V3.0 lock \+ Doc 04B V4.3 architectural decisions. Drops `form_equating_offset`. Makes `test_forms.score_table_version` an FK to `scoring_model_versions(version)`. Adds form-publish gate (DB-trigger checks score\_table\_version active status and routing thresholds in expected range OR override recorded; application handler additionally validates module composition via V4.3 §13). Adds two new hard invariants (\#13 missing rows are valid blanks; \#14 canonical answer state is the sole downstream contract). Reaffirms no mastery emission from Doc 04 (Parent V3.0 RB-V3-07). Structural reorganization to match reviewer's 19-section layout. New supersession crosswalk (§20). | Parent V3.0 lock \+ Parent V3.0 reviewer 10-point mandate for 04A V2.2 |
| V2.2 lock-cycle cleanup | 2026-05-12 | Karl \+ ChatGPT (SWE review) | Post-review cleanup applied within the V2.2 lock cycle (no version bump): **BL1** selectable-vs-scoreable separation (new `is_selectable` \+ `retired_for_new_sessions_at` columns on `test_forms`; new `form_not_available` 409 error; explicit Product/Content runbook hook for retiring forms on version supersession; new invariant integration tests as acceptance criterion \#16); **BL2** publish-handler ownership phrasing tightened (04A owns the endpoint; Doc 01 owns auth; Doc 02 owns question metadata; 04B owns `validate_form_composition()`); **BL3** publish-gate validation failures now surface as `409 invalid_form_publish_config` with structured subcodes per new §16.3 (`score_table_version_not_found`, `score_table_version_not_active`, `routing_threshold_override_required`, `invalid_form_composition`) — HTTP 500 removed from publish error path; **BL4** new invariant \#16 making partial-scoring eligibility explicit (`submitted` only; `module1_submitted` alone never produces a scoreable partial section); §14.4 outbox payload now carries `scoreable: boolean` per section; new acceptance criterion \#17; **HIGH1** idempotency body-mismatch detection (return original response per contract, emit `idempotency_body_mismatch` audit event for observability); **HIGH2** deterministic tie-breaker for concurrent writes (commit-order winner via `test_session_answers.last_submission_id`; audit-ordering tie-breaker chain `test_answer_submissions.created_at` then `id`); **MED1** `routing_override_approved_by` strengthened from text to `uuid REFERENCES admins(id)`; new `routing_override_ticket_id text NULL` column for scoring-impacting override discipline; immutability trigger \+ CHECK constraint updated; **MED2** publish UPDATE switched from `now()` to `clock_timestamp()` for runtime-time consistency. | ChatGPT SWE review verdict "PASS with required cleanup" |

---

**End of Doc 04A V2.2.**

The seam holds. 04A writes runtime truth and outbox events; 04B reads outbox events and produces scoring truth; Doc 05 reads canonical answer state. No direct calls across the seam.

