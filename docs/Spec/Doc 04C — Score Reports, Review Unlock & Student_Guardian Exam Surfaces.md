# **Doc 04C — Score Reports, Review Unlock & Student/Guardian Exam Surfaces**

**Version:** V1.0 **Status:** **LOCKED 2026-05-12** — fresh canonical against Parent V3.0 §3 subdoc map; ChatGPT SWE review cleanup (round 1: 3 items \+ 3 alignment decisions; round 2: 2 consistency fixes \+ 1 polish note) applied within lock cycle (no version bump; see Change Records) **Scope:** SAT MVP — score reports, review unlock, student/guardian/admin report surfaces **Audience:** Engineering, QA, Ops, Content, Product **Owns:** score report API surface, review unlock rules, student-safe and guardian-safe report payloads, partial-score report behavior, failed-scoring display behavior, modeled-score disclosure rendering, `score_runs` projection, answer review access rules, post-completion question/explanation visibility, student-facing claims discipline **Does NOT own:** exam runtime state machine (04A), scoring formula and `score_runs` creation (04B), observability/audit event enumeration (04D), mastery math (Doc 05), question authoring (Doc 02), entitlement/auth implementation (Doc 01\)

**Depends on:** Doc 04 Parent V3.0 (LOCKED 2026-05-12). Doc 04A V2.2 (LOCKED 2026-05-12). Doc 04B V4.3 (spec-locked 2026-05-12; deploy-time attestation values pending — see Parent V3.0 §14). Doc 04D (pending; failure ledger consumed by §10). Doc 02 series (Question Bank & Canonical Content). Doc 01 (Identity, Roles & Entitlement). Doc 00 (Authoritative Platform Directive).

**Keywords.** MUST, MUST NOT, SHOULD, SHOULD NOT, MAY follow RFC 2119\.

---

## **Design provenance (V1.0)**

This is the V1.0 fresh canonical draft. There is no prior V0.x to supersede. The document derives from:

* **Parent V3.0 §3 subdoc family map** — locks 04C's scope as "Diagnostics & Report Payload" and explicitly defers the canonical report-state machine to this doc.  
* **Karl's scope outline (2026-05-12)** — establishes the 20-section structure, the 5 hard invariants, the `ReportState` enum, the payload sketches for full / partial / failed reports, and the API surface skeleton.  
* **04A V2.2 §3.5, §13.4, §13.5** — locks the chain "04A writes completion outbox → 04B writes `score_runs` → 04C gates review unlock on `score_runs` presence."  
* **04B V4.3 §9, §11, §12, §19** — locks the `score_runs` schema 04C reads from (`total_scaled`, `partial_display_scaled`, per-section scaled, decomposition fields, `score_run_id`, `scoring_model_version`).  
* **Parent V3.0 §10.2 \+ §12** — locks the modeled-score disclosure discipline and the forbidden-phrases list.

### **Relationship to Parent V3.0's report-state sketch**

Parent V3.0 §10 documented a high-level report-state sketch (`not_available | raw_available_scaled_pending | complete | partial_scored_abandoned | failed_requires_review`) for cross-doc coordination but explicitly noted that the canonical enum lives in Doc 04C. V1.0 establishes the canonical enum (§5.1), which:

* Renames three states to align with consumer-facing semantics (`not_completed`, `scoring_pending`, `scored`, `partial_scored`)  
* Preserves `failed_requires_review` verbatim  
* Adds two new MVP-reserved states (`voided`, `unavailable`) for administrative and access-control cases not yet covered by Parent V3.0

A mapping table is provided in §5.1 so any downstream consumer that read Parent V3.0's sketch can rewire cleanly. This is not a re-litigation of Parent V3.0; it is the canonical exercise of the authority Parent V3.0 already delegated.

---

## **1\. Purpose**

Doc 04C defines the **read/projection contract** for everything a student, guardian, or admin sees about a completed (or partially completed, or failed) full-length exam attempt. The runtime layer (04A) owns session state; the scoring layer (04B) owns score computation; 04C owns:

* **What state the report is in** at any moment, derived deterministically from upstream signals.  
* **What payload** a student / guardian / admin receives for each state.  
* **When review unlocks** (post-scoring) and what review surfaces expose.  
* **What disclosure copy** travels with every scaled score, framing it as a Lyceon-modeled estimate aligned with a third-party DSAT benchmark and NOT a certified-official score.  
* **What anti-leak rules** govern post-completion question / explanation visibility (transitioning from 04A's pre-submit anti-leak posture to 04C's post-submit review semantics).

04C is **read-mostly**: it projects state from already-canonical sources (`test_sessions`, `score_runs`, `exam_failure_ledger`) rather than writing its own canonical state. The optional view-tracking writes in §4.4 are operational-grade analytics, not canonical state.

**What changed by virtue of locking 04C:** the report-state machine becomes auditable; partial-scoring behavior gets explicit copy rules; the failed-state display reads from 04D's failure ledger (Parent V3.0 §10.2 contract); guardian visibility constraints get spelled out (Parent V3.0 §15 family); review unlock becomes a derivable boolean rather than an implicit assumption.

---

## **2\. Parent V3.0 inherited constraints**

The constraints below are inherited from Parent V3.0 and are not negotiable at the 04C level. Changes require Parent revision.

### **2.1 No "imputed" or "predicted" scores (Parent V3.0 §3 hard guarantee \+ §12 forbidden phrases)**

Every report visible to a student or guardian MUST trace to either:

* a `score_runs` row produced by 04B's orchestrator, OR  
* a documented terminal failure state (per §10) backed by 04D's failure ledger, OR  
* a documented non-terminal state (`not_completed`, `scoring_pending`, `unavailable`, `voided`).

04C MUST NOT:

* Invent or estimate a missing scaled score.  
* Use prior performance to "fill in" a partial result.  
* Generate predictive copy like "you would have scored X" or "projected total."  
* Frame scaled scores as official SAT scores or as College Board-endorsed.

The full forbidden-phrases discipline is in §15 (modeled-score disclosure requirements).

### **2.2 No mastery events from Doc 04 → Doc 05 (Parent V3.0 RB-V3-07, RB-V3-08; hard guarantee \#11)**

04C is a read consumer, not a writer of mastery signals. 04C MUST NOT emit any event that Doc 05 consumes for mastery updates. Doc 05 reads canonical answer state (`test_session_answers JOIN questions`) directly per 04A V2.2 §3.1, §3.2. 04C's role in mastery is zero.

### **2.3 `module2_path` is never student/guardian-facing (Parent V3.0 §9 \#15; V4.3 §17; 04A V2.2 §3.4)**

The routed Module 2 path (`A` or `B`) MUST NOT appear in any student-facing or guardian-facing API response, report field, copy string, or UI element. Internal admin / audit responses MAY expose it.

04C extends this disclosure doctrine: scaled-score copy and review surfaces MUST NOT carry phrases that imply path knowledge — including "easy module," "hard module," "routed up," "routed down," "you got the harder second module," etc.

### **2.4 Modeled-score discipline (Parent V3.0 §12; §7.4 Test Ninjas framing)**

Scaled scores returned by 04C are framed as **Lyceon-modeled estimates aligned with a third-party DSAT benchmark calculator**, NOT as certified-official scores. Every report payload MUST carry the disclosure version that was active when the underlying `score_run` was produced. See §15 for the full disclosure contract.

### **2.5 Review unlock is gated on `score_runs` success (Parent V3.0 §9 \#9; 04A V2.2 §3.5, §13.4)**

Review mode (post-completion question \+ explanation visibility) MUST NOT unlock until 04B has produced a successful `score_runs` row for the session. The dependency chain is:

04A writes completion outbox row  
    ↓  
04B orchestrator consumes outbox event, validates version (V4.3 §12.1 gate),  
    computes scaled scores, inserts score\_runs row  
    ↓  
04C reads score\_runs; if present and successful, unlocks review

If `score_runs` is absent because 04B failed permanently (V4.3 §19.6 unattested-version path or any §19 hard failure), 04C reads from 04D's failure ledger and surfaces `failed_requires_review` (§10).

### **2.6 Guardian access is derived (Parent V3.0 §15 family; Doc 01\)**

Guardian visibility of a student's report is derived from two conditions, both required:

1. An active guardian-student link exists per Doc 01\.  
2. The student's entitlement covering full-length exams is active.

Guardians are view-only. Guardians have no write access to any 04C-owned surface. Guardian payloads (§12) are a strict subset of the student payload (§11) — never a superset.

### **2.7 Anti-leak posture transitions at review unlock**

Pre-submit, 04A serves question payloads without `correct_answer`, `correct_variants`, `explanation`, `domain`, `skill_code`, or `difficulty` (04A V2.2 §10.2 anti-leak projection). Post-completion \+ review unlock, 04C MAY expose these fields under the rules in §14. The transition is gated on review unlock (§6); it is not gated on session completion alone.

---

## **3\. Hard report invariants**

These cannot be violated. Tests verify them. Application logic enforces them.

1. **No report before score readiness.** A completed full-length session does NOT unlock review until 04B has produced a successful `score_runs` row OR a terminal failure state has been recorded in 04D's failure ledger. If `test_sessions.state = 'completed'` but no `score_runs` row exists yet and no failure ledger entry exists yet, the report state is `scoring_pending` and `review_unlocked = false`.  
2. **Partial score MUST NEVER masquerade as a full SAT total.** For `partial_scored_abandoned` sessions, `total_scaled` MUST be `null` in every consumer-facing payload. The section-level score is exposed via `partial_display_scaled` (per 04B V4.3 §9.1) and labeled as a section score. Student-facing copy MUST say which section is reported and which is missing. Forbidden: "Your SAT score is 670"; "Estimated total: 670"; "Projected total." Allowed: "RW section score: 670"; "Math was not completed, so no total score is available."  
3. **`module2_path` is never student/guardian-facing.** Inherits from Parent V3.0 §9 \#15 and 04A V2.2 §3.4. 04C MUST NOT expose `module2_path` directly, and MUST NOT use copy that implies path knowledge (§2.3 examples).  
4. **Modeled-score disclosure travels with every report.** Every scaled score MUST be accompanied by the disclosure version that was active when the underlying `score_run` was produced. The disclosure is part of the payload (§15), not a separate UI concern. Forbidden phrases per §15 are enforced at serializer level.  
5. **Review payloads can reveal explanations ONLY after unlock.** During active exam, 04A forbids `correct_answer`, `correct_variants`, `explanation`, `domain`, `skill_code`, `difficulty` in question payloads. 04C MAY expose these post-completion ONLY AFTER `review_unlocked = true`. Pre-unlock (`scoring_pending`, `failed_requires_review`, `not_completed`, `voided`, `unavailable`), 04C MUST NOT serve any review payload carrying these fields.  
6. **Report state is derived, not stored.** 04C does NOT persist a `report_state` column. It derives the state at read time from `test_sessions.state`, `score_runs` presence, and `exam_failure_ledger` presence per §5.4. This guarantees the report state cannot drift from canonical truth — any change to upstream sources is immediately reflected.  
7. **Guardian payloads are a strict subset of student payloads.** Every field a guardian sees MUST also be visible to the student. Guardians MUST NOT see fields the student does not see. This is enforced by deriving the guardian payload from the student payload via a projection function (§12.2), not by independent construction.  
8. **No canonical fan-out from 04C.** 04C does NOT emit canonical state-changing events. It MAY emit non-blocking 04D audit events for access logging (per §16.5 step 8), but no downstream system may treat 04C's audit events as canonical state — they are observability artifacts, not state transitions. View-tracking writes (§4.4, optional) are analytics-grade only and do not gate anything downstream. 04C's primary outputs are HTTP responses to authenticated reads; everything else is non-blocking auxiliary.

---

## **4\. Data / read model**

04C is read-mostly. The tables it reads from are owned by other docs; 04C does not redefine them. This section enumerates the read surface, the derived view 04C uses for efficient querying, and the optional view-tracking writes 04C MAY perform if Product requires them.

### **4.1 Tables read (owned elsewhere)**

| Table | Owner | What 04C reads |
| ----- | ----- | ----- |
| `test_sessions` | 04A V2.2 §5.3 | `id`, `student_id`, `test_form_id`, `state`, `mode`, `started_at`, `completed_at`, `abandoned_at`, `attempt_number_for_form`, `is_first_seen_form_attempt` |
| `test_session_sections` | 04A V2.2 §5.4 | `section`, `state`, `module2_path` (internal only — never in student/guardian payload), `module1_submitted_by`, `module2_submitted_by`, `module1_submitted_at`, `module2_submitted_at` |
| `test_form_items` | 04A V2.2 §5.2 | `section`, `module`, `ordinal`, `question_id` (for review item ordering) |
| `test_session_answers` | 04A V2.2 §5.6 | `section`, `module`, `ordinal`, `question_id`, `answer`, `last_submission_id`, `updated_at` (for review item rendering) |
| `score_runs` | 04B V4.3 §9 | `id` (used as `score_run_id`), `total_scaled`, `partial_display_scaled`, `rw_scaled`, `math_scaled`, decomposition fields (admin-only), `scoring_model_version`, `source_outbox_event_id`, `created_at` |
| `scoring_model_versions` | 04B V4.3 §7.2 | `version`, `disclosure_version` (if 04B carries it; else 04C resolves via a disclosure-version-by-scoring-version mapping table — see §15.4) |
| `questions` | Doc 02 | `id`, `stem`, `options`, `correct_answer`, `correct_variants`, `explanation`, `domain`, `skill_code`, `difficulty`, `assets` (review surface only) |
| `exam_failure_ledger` | 04D (pending) | `test_session_id`, `source`, `failure_code`, `failure_message`, `severity`, `status`, `created_at` (for §10 failed-state display) |
| `test_forms` | 04A V2.2 §5.1 | `name`, `score_table_version` (for cross-reference; admin display only) |

Doc 01 owns the guardian-student link table and entitlement state, which 04C reads via the Doc 01 predicate `guardian_can_view_student_report(guardian_id, student_id)` — 04C does NOT inspect Doc 01's tables directly.

### **4.2 Derived report view (recommended; non-canonical)**

04C MAY materialize a read-only view for query efficiency. This view is purely a JOIN convenience; it does not introduce new canonical state.

CREATE VIEW v\_exam\_reports AS  
SELECT  
  ts.id AS test\_session\_id,  
  ts.student\_id,  
  ts.test\_form\_id,  
  ts.state AS session\_state,  
  ts.mode,  
  ts.completed\_at,  
  ts.abandoned\_at,  
  ts.attempt\_number\_for\_form,  
  ts.is\_first\_seen\_form\_attempt,  
  sr.id AS score\_run\_id,  
  sr.total\_scaled,  
  sr.partial\_display\_scaled,  
  sr.rw\_scaled,  
  sr.math\_scaled,  
  sr.scoring\_model\_version,  
  sr.created\_at AS scored\_at,  
  fl.id AS failure\_ledger\_id,  
  fl.failure\_code,  
  fl.severity AS failure\_severity,  
  fl.status AS failure\_status,  
  fl.created\_at AS failure\_recorded\_at  
FROM test\_sessions ts  
LEFT JOIN score\_runs sr  
  ON sr.test\_session\_id \= ts.id  
LEFT JOIN LATERAL (  
  SELECT \*  
  FROM exam\_failure\_ledger  
  WHERE test\_session\_id \= ts.id  
    AND status IN ('open', 'acknowledged')  
  ORDER BY created\_at DESC  
  LIMIT 1  
) fl ON true;

The `LEFT JOIN LATERAL` against `exam_failure_ledger` picks the most-recent open or acknowledged failure for the session. Resolved failures do NOT surface here — they are operational history, not display state.

**This view is a query convenience, not a canonical state surface.** Removing it must not change observable behavior; the derivation logic in §5.4 is the canonical reference.

### **4.3 Doc 02 question fetch contract**

For review surfaces (§13), 04C fetches questions from Doc 02 by `question_id`. The fetch contract:

* Returns the full canonical question record including `correct_answer`, `correct_variants`, `explanation`, `domain`, `skill_code`, `difficulty`, `assets`.  
* 04C MUST verify `test_form_items` contains a matching `(test_form_id, section, module, ordinal, question_id)` row before serving any review item — i.e., 04C MUST NOT trust an arbitrary `question_id` from the client; it MUST cross-check against the canonical form composition.  
* For partial-scored sessions, 04C serves review items only for sections that reach `submitted` state per 04A V2.2 invariant \#16 (Module 2 must have submitted). Sections in `module1_submitted` state are NOT review-eligible even though Module 1 answers exist (§13.3).

### **4.4 Optional view-tracking writes**

Per Karl's scope: "Possible writes: `report_viewed_at`, `review_started_at`, `guardian_report_viewed_at`. Only include these if product needs them. Otherwise leave analytics to 04D / Doc 09."

V1.0 stance: **defer to 04D / Doc 09**. 04C does NOT write canonical view-tracking columns in MVP. Report-access auditing is owned by 04D (audit-event `exam_report_requested`, `exam_report_returned`, `guardian_exam_report_requested`, etc. per Karl's audit taxonomy). 04D's audit events provide stronger consistency (transactional with auth checks) and clearer ownership.

If Product later requires direct view-tracking columns on `test_sessions` or a new table, that change goes through:

1. Product spec authoring (what is "first view" vs subsequent)  
2. 04D schema addition or column addition on `test_sessions`  
3. 04C V1.1 revision pointing at the canonical writer

V1.0 keeps 04C strictly read-only.

### **4.5 Read-path indexes (operational guidance)**

For acceptable read latency, the following indexes should exist (most are already in upstream docs; listing here for completeness):

| Index | Owner | Purpose for 04C |
| ----- | ----- | ----- |
| `score_runs(test_session_id)` UNIQUE | 04B V4.3 | Primary lookup for report-state derivation |
| `exam_failure_ledger(test_session_id, status, created_at DESC)` | 04D | Failed-state derivation (§5.4) |
| `test_session_answers(test_session_id, section, module)` | 04A V2.2 §5.6 | Review-item ordering |
| `test_form_items(test_form_id, section, module, ordinal)` UNIQUE | 04A V2.2 §5.2 | Review-item canonical ordering |

04C does NOT add new indexes; it consumes existing ones.

---

## **5\. Report lifecycle**

This section is the heart of 04C: how report state is derived from upstream signals.

### **5.1 Canonical `ReportState` enum**

type ReportState \=  
  | 'not\_completed'           // session exists but is not yet in completed or partial-scored-abandoned state  
  | 'scoring\_pending'         // session is completed (or partial-scored-abandoned) but no score\_runs row exists yet  
  | 'scored'                  // session is completed AND score\_runs row exists with total\_scaled NOT NULL  
  | 'partial\_scored'          // session is partial\_scored\_abandoned AND score\_runs row exists with partial\_display\_scaled  
  | 'failed\_requires\_review'  // session is completed (or partial\_scored\_abandoned) AND no score\_runs AND failure ledger has an open entry  
  | 'voided'                  // session is administratively voided (out-of-scope for MVP; reserved enum value)  
  | 'unavailable';            // session exists but report cannot be returned (entitlement lapsed, content takedown, etc.)

**Mapping to Parent V3.0 §10's earlier sketch** (for any consumer that read the earlier sketch):

| Parent V3.0 §10 sketch | 04C V1.0 canonical | Note |
| ----- | ----- | ----- |
| `not_available` | `not_completed` (when session is non-terminal) OR `unavailable` (when access denied) | Split into two cases for clarity; Parent's `not_available` was ambiguous between "session ongoing" and "access denied" |
| `raw_available_scaled_pending` | `scoring_pending` | Renamed for consumer-facing clarity |
| `complete` | `scored` | Renamed for consumer-facing clarity |
| `partial_scored_abandoned` | `partial_scored` | Renamed; the suffix "\_abandoned" leaks runtime mechanics into report state |
| `failed_requires_review` | `failed_requires_review` | Unchanged |
| (not in Parent's sketch) | `voided` | NEW; reserved for administrative voiding (out-of-scope for MVP) |

`voided` and `unavailable` are MVP-reserved enum values. `unavailable` is implemented in V1.0 (derives from entitlement / Doc 01 checks at read time). `voided` is reserved but not implemented in V1.0 (no admin-voiding workflow exists yet; when one is added, it will be implemented via a 04D admin-action audit row that 04C reads).

### **5.2 State diagram (high-level)**

               ┌────────────────┐  
                │ session exists │  
                └────────┬───────┘  
                         │  
                         ▼  
              ┌──────────────────────┐  
              │ entitlement / access │   ─── denied ──▶  unavailable  
              │   check (Doc 01\)     │  
              └──────────┬───────────┘  
                         │ granted  
                         ▼  
              ┌──────────────────────┐  
              │ admin-voided?        │   ─── yes  ──▶   voided  
              │ (04D audit row)      │  
              └──────────┬───────────┘  
                         │ no  
                         ▼  
              ┌──────────────────────┐  
              │ session.state        │  
              └──────────┬───────────┘  
                         │  
       ┌─────────────────┼─────────────────────┐  
       │                 │                     │  
   created/active/  completed /          abandoned\_final  
   section\_break    partial\_scored\_       (no sections submitted)  
       │            abandoned                  │  
       ▼                 │                     ▼  
   not\_completed         │                 not\_completed  
                         ▼  
              ┌──────────────────────┐  
              │ score\_runs present?  │  
              └──────────┬───────────┘  
                         │  
                ┌────────┼────────┐  
                │        │        │  
              yes      no, but    no, and  
                │      failure    failure  
                │      ledger     ledger  
                │      has open   has NO  
                │      entry     open entry  
                │        │        │  
                ▼        ▼        ▼  
              scored   failed\_   scoring\_  
              or       requires\_ pending  
              partial\_ review  
              scored

`abandoned_final` (session terminated with no sections submitted) maps to `not_completed`, NOT to a separate "abandoned-no-score" state. The student has no scoreable result, so there is nothing to display beyond "session did not produce a score."

### **5.3 Derivation function (canonical)**

The canonical report-state derivation is a pure function over upstream signals. 04C implementations MUST behave as if executing the following logic:

type AccessCheckResult \=  
  | { granted: true }  
  | { granted: false; classification: 'never\_existed' }  
  | { granted: false; classification: 'revoked'; reason: 'entitlement\_lapsed' | 'guardian\_link\_inactive' | 'content\_takedown' };

function deriveReportState(  
  session: TestSession,  
  scoreRun: ScoreRun | null,  
  openFailureLedgerEntry: FailureLedgerEntry | null,  
  accessCheck: AccessCheckResult,  
  voidedRecord: AdminVoidRecord | null  // from 04D admin audit; null in MVP  
): { state: ReportState; httpStatus: 200 | 403 } {  
  // Access check FIRST — split by classification per V1.0 lock-cycle alignment.  
  if (\!accessCheck.granted) {  
    if (accessCheck.classification \=== 'never\_existed') {  
      // Wrong session, no guardian link, or no relationship has ever existed.  
      // Treat as anti-enumeration: HTTP 403, no state-bearing payload.  
      // (Caller responsible for raising; this function signals the discriminant.)  
      return { state: 'unavailable', httpStatus: 403 };  
    }  
    // Revoked: relationship existed (current student / current guardian link), but access is currently denied.  
    // HTTP 200 with an explicit \`unavailable\` payload that explains the revocation.  
    return { state: 'unavailable', httpStatus: 200 };  
  }

  if (voidedRecord \!== null) return { state: 'voided', httpStatus: 200 };

  switch (session.state) {  
    case 'created':  
    case 'active':  
    case 'section\_break':  
    case 'abandoned\_final':  
      return { state: 'not\_completed', httpStatus: 200 };

    case 'completed':  
      if (scoreRun \!== null && scoreRun.total\_scaled \!== null) return { state: 'scored', httpStatus: 200 };  
      if (openFailureLedgerEntry \!== null) return { state: 'failed\_requires\_review', httpStatus: 200 };  
      return { state: 'scoring\_pending', httpStatus: 200 };

    case 'partial\_scored\_abandoned':  
      if (scoreRun \!== null && scoreRun.partial\_display\_scaled \!== null) return { state: 'partial\_scored', httpStatus: 200 };  
      if (openFailureLedgerEntry \!== null) return { state: 'failed\_requires\_review', httpStatus: 200 };  
      return { state: 'scoring\_pending', httpStatus: 200 };  
  }  
}

**Access check classification (V1.0 lock-cycle alignment).** The access check returns one of three outcomes:

* `granted: true` — proceed with state derivation per upstream session state.  
* `granted: false, classification: 'never_existed'` — the requester has no current relationship with this session. Triggered by: wrong session (student endpoint, `test_sessions.student_id != auth_student.id`); no current guardian-student link; no session row at all. Response: HTTP 403 forbidden with no state-bearing body (anti-enumeration; existence is not revealed).  
* `granted: false, classification: 'revoked'` — the requester HAS a current relationship (current ownership for students; current active guardian-student link for guardians) but a specific gating condition has revoked access. Triggered by: student entitlement currently inactive; guardian's view of student entitlement currently inactive (link active but entitlement isn't); admin content takedown. Response: HTTP 200 with the `unavailable` payload (§11.5b) carrying the revocation reason so the client can render meaningful "your access is currently paused" copy.

**Why this split.** Returning HTTP 403 for never-existed cases prevents enumeration (a probing request gets the same 403 whether the session exists or not). Returning HTTP 200 with an `unavailable` payload for revoked cases gives the UI enough information to render actionable copy ("renew your subscription" vs "your guardian link was deactivated"). The split is Karl's V1.0 lock-cycle decision; the reviewer's RB-04C-V1-03 surfaced the tension between §12.1 and §16.6 in V1.0 draft.

**Determinism.** The function is pure: same inputs → same output. Re-deriving on the next read yields the same state unless one of the inputs changed. This is invariant \#6 — report state is derived, not stored.

**Ordering of checks.** Access classification comes FIRST so a never-existed-access requester does not receive a payload that leaks failure or session details. Revoked access is distinct from session-state and admin-voided checks (which apply to a relationship that DOES exist) — those run only after `granted: true` is established for the revoked classification, or are entirely bypassed for never-existed.

**MVP simplification.** The `voidedRecord` input is always `null` in V1.0 because no admin-voiding workflow exists yet (alignment-confirmed: `voided` enum value is MVP-reserved). The branch is preserved so that when 04D adds the workflow, 04C does not need a code change beyond wiring the input.

### **5.4 Transition triggers (informational; 04C does not write)**

04C does not own these transitions — it observes them. They are listed for completeness:

| Transition | Trigger (upstream) | Owner |
| ----- | ----- | ----- |
| `not_completed` → `scoring_pending` | `test_sessions.state` moves to `completed` or `partial_scored_abandoned`; outbox row written; `score_runs` not yet inserted | 04A (state) \+ 04A (outbox) |
| `scoring_pending` → `scored` | 04B orchestrator inserts a `score_runs` row with `total_scaled IS NOT NULL` | 04B V4.3 §12 |
| `scoring_pending` → `partial_scored` | 04B orchestrator inserts a `score_runs` row with `partial_display_scaled IS NOT NULL` and `total_scaled IS NULL` | 04B V4.3 §12 \+ §15.2 |
| `scoring_pending` → `failed_requires_review` | 04B orchestrator raises (V4.3 §19 hard failure) and 04D writes an open `exam_failure_ledger` entry | 04B \+ 04D |
| any → `unavailable` | Doc 01 entitlement state changes; guardian-student link inactivated; content takedown | Doc 01 |
| any → `voided` | Admin audit row written by support tooling (post-MVP) | 04D (future) |
| `failed_requires_review` → `scored` or `partial_scored` | 04D failure ledger entry resolved; 04B re-run produces a `score_runs` row | 04B \+ 04D |

Note the last row: a session in `failed_requires_review` can transition to a successful state if ops fixes the underlying issue and 04B re-scores. 04C reflects this automatically on the next read because state is derived.

### **5.5 No state cache**

04C MUST NOT cache derived report state. Every read re-derives from upstream sources. This guarantees correctness across:

* Score completion arriving moments after the report-status poll  
* Failure resolution that should immediately surface as `scored`  
* Entitlement changes that immediately revoke access  
* Admin actions (future) that void a report

Implementations MAY cache the `(test_session_id → score_runs row, failure_ledger entry)` tuple inside a single request handler for efficiency, but cross-request caching is forbidden.

---

## **6\. Review unlock rules**

"Review unlock" means: post-completion, the student (and admin / guardian per their access scope) may access the question-level review surface (§13) which exposes `correct_answer`, `explanation`, `domain`, `skill_code`, `difficulty`. This is the transition out of 04A's pre-submit anti-leak posture (§2.7).

### **6.1 Unlock predicate**

function reviewUnlocked(state: ReportState): boolean {  
  return state \=== 'scored' || state \=== 'partial\_scored';  
}

That is the entire rule:

* `scored` → review unlocked (full session scored successfully)  
* `partial_scored` → review unlocked (at least one section scored; §6.3 scopes the unlock per section)  
* Every other state → review locked

### **6.2 Scope of unlock**

* For `scored` sessions, both sections (RW and Math) are review-eligible.  
* For `partial_scored` sessions, ONLY sections that reach `test_session_sections.state = 'submitted'` are review-eligible per 04A V2.2 invariant \#16. Sections in `module1_submitted` state (Module 1 routed but Module 2 never submitted) are NOT review-eligible even though Module 1 answers exist — V1.0 design decision per §6.3 rationale.

### **6.3 Why `module1_submitted` sections are not review-eligible**

A section in `module1_submitted` state has Module 1 answers recorded and a `module2_path` locked, but no Module 2 attempt. Exposing review for that section would:

* Leak the locked `module2_path` indirectly (the review item set would be Module 1 only, signaling no Module 2 was attempted — student could infer routing trajectory by comparing to a similarly-structured peer's session).  
* Create an inconsistency with 04A V2.2 invariant \#16 (only `submitted` is scoreable; review-eligibility should match scoreability).  
* Force 04C to define a "Module 1 only" review payload shape that has no consumer downstream (04B does not score Module 1 alone; Doc 05 will not consume Module-1-only outcomes when drafted).

The clean rule: review eligibility tracks scoreability. If 04B did not score it, 04C does not review it.

### **6.4 Unlock does NOT depend on disclosure acknowledgement**

The student is NOT required to click through a disclosure modal before review unlocks. Disclosure is rendered as part of the report payload (§15); review unlocks independently based on state. This avoids creating a UI-gated unlock that engineering would need to track. Disclosure-acknowledged tracking, if Product wants it, is a separate Product/UX feature; 04C's MVP contract is "disclosure travels with payload."

### **6.5 Unlock does NOT depend on guardian payment**

Per Parent V3.0 §15 family, entitlement is student-scoped. Guardian payment funds the student's entitlement, but guardian payment status does not gate the student's review access — only the student's entitlement status does. This is enforced at the `unavailable` derivation step (§5.3): if entitlement lapses, the report becomes `unavailable` and review locks regardless of prior unlock state.

---

## **7\. `score_run` projection contract**

This section defines how 04C reads from `score_runs` and what fields it forwards to consumers. The schema is owned by 04B V4.3 §9; 04C is a strict consumer.

### **7.1 Fields read from `score_runs`**

| Field | Type | Used in payload | Visibility |
| ----- | ----- | ----- | ----- |
| `id` | uuid | `score_run_id` | Student, guardian, admin |
| `test_session_id` | uuid | (key only) | (internal) |
| `scoring_model_version` | text | `score.scoring_model_version` | Student, guardian, admin (transparency signal) |
| `total_scaled` | int | `score.total_scaled` | Student, guardian (when `scored`) |
| `partial_display_scaled` | int | `score.partial_display_scaled` | Student, guardian (when `partial_scored`) |
| `rw_scaled` | int | `score.rw_scaled` | Student, guardian |
| `math_scaled` | int | `score.math_scaled` | Student, guardian |
| `rw_module1_correct` | int | (admin only) `decomposition.rw_module1_correct` | Admin |
| `rw_m2_easy_wrong`, `rw_m2_med_wrong`, `rw_m2_hard_wrong` | int | (admin only) | Admin |
| `math_module1_correct`, `math_m2_*_wrong` | int | (admin only) | Admin |
| `source_outbox_event_id` | uuid | (admin only) `audit.source_outbox_event_id` | Admin |
| `created_at` | timestamptz | `score.scored_at` | Student, guardian, admin |

The decomposition fields (per 04B V4.3 §9) are admin-only by 04C policy. They expose the internal Module 1 raw-correct counts and Module 2 difficulty-bucket wrong counts; surfacing these to students would (a) leak routing trajectory and (b) encourage gaming. Admin / audit endpoints (§16.4) MAY expose them.

### **7.2 No re-computation in 04C**

04C MUST NOT re-derive scaled scores from raw answers. The `score_runs` row IS the canonical score; 04C reads and forwards. If a future revision wants to display alternate aggregations (e.g., per-domain estimates), the aggregation logic belongs in 04B (which already produces the canonical decomposition), not in 04C.

### **7.3 Missing `score_runs` for completed sessions**

If `test_sessions.state = 'completed'` but `score_runs` is absent, 04C MUST NOT:

* Synthesize a placeholder `score_run_id`  
* Compute a "raw score" from `test_session_answers`  
* Estimate or interpolate any scaled score

It MUST return either `scoring_pending` (if no failure ledger entry exists) or `failed_requires_review` (if an open failure ledger entry exists) per §5.3.

### **7.4 Idempotency and duplicate `score_runs` rows**

04B V4.3 §12 guarantees insert-once semantics via `score_run_event_ledger`: a given completion outbox event produces exactly one `score_runs` row per scoring run kind. If a future 04B revision introduces score history (multiple historical rows per session) or distinct `scoring_run_kind` values (e.g., for partial vs full scoring under separate orchestrations), 04C's defensive check MUST narrow to the **current renderable** score\_run, not every historical row.

**V1.0 invariant.** If 04C observes more than one `score_runs` row eligible for the current report being rendered for a given `(test_session_id, scoring_run_kind)` — i.e., more than one row that would pass the §5.3 derivation's "score\_run is present" check at this read time — it MUST:

* Log a `report_data_integrity_violation` event (04D consumes)  
* Return HTTP 500 with the `report_data_integrity_violation` error code per §16.7  
* NOT pick one row arbitrarily, and NOT switch the report to `unavailable` (which is reserved for access-revocation cases per §5.3 split)

This is a defensive posture against an invariant violation upstream. The condition should be impossible by design, but the read path enforces it.

---

## **8\. Full score report payload**

The full report payload is what consumers receive when `report_state = 'scored'`. This is the most-common state for completed exam attempts.

### **8.1 Canonical payload shape**

type FullExamReport \= {  
  report\_state: 'scored';  
  session\_id: string;  
  test\_form\_id: string;  
  test\_form\_name: string;            // human-readable form name  
  mode: 'strict' | 'lenient';  
  completed\_at: string;              // ISO 8601 UTC  
  attempt\_number\_for\_form: number;  
  is\_first\_seen\_form\_attempt: boolean;

  score: {  
    total\_scaled: number;            // 400–1600  
    rw\_scaled: number;               // 200–800  
    math\_scaled: number;             // 200–800  
    partial\_display\_scaled: null;    // always null when scored  
    scoring\_model\_version: string;  
    score\_run\_id: string;  
    scored\_at: string;               // ISO 8601 UTC; score\_runs.created\_at  
  };

  sections: Array\<{  
    section: 'RW' | 'M';  
    section\_state: 'submitted';  
    scaled: number;  
    scoreable: true;  
  }\>;

  disclosure: {  
    disclosure\_version: string;  
    summary: string;                 // short canonical phrase, e.g. "Lyceon-modeled estimate, not an official SAT score"  
    full\_text\_url: string;           // link to the full disclosure document  
  };

  review\_unlocked: true;  
};

### **8.2 Field-by-field semantics**

* `report_state`: literal `'scored'`. Discriminator field for client-side payload routing.  
* `session_id`, `test_form_id`, `test_form_name`, `mode`: drawn from `test_sessions` \+ `test_forms`. `test_form_name` is the human-readable form name; never expose the form's `score_table_version` or routing thresholds in student-facing payloads.  
* `completed_at`: `test_sessions.completed_at`.  
* `attempt_number_for_form`, `is_first_seen_form_attempt`: drawn from `test_sessions`. These are runtime-generated values per 04A V2.2 §5.3. 04C may display them as "Attempt 2 of this form" or "First time taking this form" copy.  
* `score.*_scaled`: drawn from `score_runs`. Always non-null in this state.  
* `partial_display_scaled`: explicitly `null` when scored; the field is present in the payload shape so consumers do not need to introspect schema by state.  
* `scoring_model_version`: drawn from `score_runs.scoring_model_version`. Carries forward the version under which this report was scored — important for historical reproducibility.  
* `score_run_id`: drawn from `score_runs.id`. The canonical handle for this score; consumers can include it in support tickets.  
* `sections[]`: always two entries (RW, M) when scored. Each is `submitted` and `scoreable: true`.  
* `disclosure`: see §15 for full disclosure contract.  
* `review_unlocked`: literal `true`.

### **8.3 What is NOT in the payload**

Forbidden fields in any student/guardian-facing full report payload:

* `module2_path` or any derived signal of routing (Invariant \#3; §2.3)  
* Decomposition fields (`rw_module1_correct`, `rw_m2_easy_wrong`, etc.)  
* `source_outbox_event_id`  
* `routing_threshold_rw`, `routing_threshold_m`  
* `score_table_version` as a separate field (the version is carried in `score.scoring_model_version`, which is sufficient and labeled clearly)

### **8.4 Cohort comparison and history (out of scope for MVP)**

V1.0 does NOT include percentile, peer-comparison, or historical-trend fields in the payload. If Product wants these in a future revision, they would be added under a separate top-level key (e.g., `cohort_signals: { ... }`) with their own disclosure copy. They are NOT to be inferred or computed at the 04C layer — they require an explicit data product owned elsewhere.

---

## **9\. Partial score report payload**

The partial report payload is what consumers receive when `report_state = 'partial_scored'`. The session reached `partial_scored_abandoned` per 04A V2.2 §14 and 04B produced a `score_runs` row with at least one section scored.

### **9.1 Canonical payload shape**

type PartialExamReport \= {  
  report\_state: 'partial\_scored';  
  session\_id: string;  
  test\_form\_id: string;  
  test\_form\_name: string;  
  mode: 'strict' | 'lenient';  
  abandoned\_at: string;              // ISO 8601 UTC; from test\_sessions.abandoned\_at  
  attempt\_number\_for\_form: number;  
  is\_first\_seen\_form\_attempt: boolean;

  score: {  
    total\_scaled: null;              // ALWAYS null in partial state — see invariant \#2  
    rw\_scaled: number | null;        // present if RW section is scoreable  
    math\_scaled: number | null;      // present if M section is scoreable  
    partial\_display\_scaled: number;  // section-level 200–800 display value; ALWAYS present when report\_state \= partial\_scored  
    scoring\_model\_version: string;  
    score\_run\_id: string;            // ALWAYS present when report\_state \= partial\_scored (a score\_runs row exists by construction)  
    scored\_at: string;  
  };

  sections: Array\<{  
    section: 'RW' | 'M';  
    section\_state: 'submitted' | 'module1\_submitted' | 'module1\_active' | 'not\_started';  
    scaled: number | null;  
    scoreable: boolean;  
    incompleteness\_reason: 'timed\_out' | 'never\_attempted' | 'module1\_only' | null;  
  }\>;

  completed\_sections: Array\<'RW' | 'M'\>;       // subset that reached submitted state  
  incomplete\_sections: Array\<'RW' | 'M'\>;      // subset that did NOT reach submitted state

  disclosure: {  
    disclosure\_version: string;  
    summary: string;  
    full\_text\_url: string;  
  };

  partial\_disclosure: {  
    summary: string;     // canonical copy explaining why no total  
    full\_text\_url?: string;  
  };

  review\_unlocked: true;  // scoped per section in §6.2 / §13.3  
};

### **9.2 Field-by-field semantics — partial-specific**

* `score.total_scaled`: ALWAYS `null` in `partial_scored`. Invariant \#2 — partial MUST NOT masquerade as total. The field is present in the shape for consumer convenience; its value is fixed.  
* `score.partial_display_scaled`: drawn from `score_runs.partial_display_scaled` (04B V4.3 §9.1). For sessions where exactly one section is scoreable, this equals that section's scaled score. If both sections are scoreable but the runtime ended in `partial_scored_abandoned` (unusual but possible), 04B's decision (per V4.3 §9.1) on `partial_display_scaled` is forwarded as-is.  
* `sections[].section_state`: drawn from `test_session_sections.state`. Possible values are the full 04A enum (`not_started`, `module1_active`, `module1_submitted`, `module2_active`, `submitted`) — 04C exposes the actual section state so the consumer can render explanatory copy.  
* `sections[].scoreable`: drawn from the partial-scoring outbox payload (04A V2.2 §14.4 `scoreable` field) per invariant \#16. Only `section_state = 'submitted'` is `scoreable: true`.  
* `sections[].incompleteness_reason`: **04C V1.0 addition for client rendering convenience** (not in the original scope sketch; introduced here because clients need to render different copy per incomplete reason). Values:  
  * `null` when `scoreable: true`  
  * `'timed_out'` when `section_state = 'submitted'` AND module timeout submit was involved (drawn from `test_session_sections.module2_submitted_by = 'timeout'`)  
  * `'module1_only'` when `section_state = 'module1_submitted'` (M1 routed but M2 never attempted)  
  * `'never_attempted'` when `section_state IN ('not_started', 'module1_active')` (no completed module)  
* `partial_disclosure.summary`: canonical copy from §15.5 — explains why no total is available.

### **9.3 Required partial copy (canonical examples)**

The copy below is canonical examples for the `partial_disclosure.summary` field; actual production copy is Product-owned but MUST satisfy invariant \#2 (no total framing).

Allowed (canonical examples):

* "RW section score: 670\. Math was not completed, so no total score is available."  
* "Math section score: 590\. RW was not completed, so no total score is available."  
* "Module 1 was submitted but Module 2 was not completed for the Math section, so no Math score is available."

Forbidden (per invariant \#2):

* "Your SAT score is 670." (implies a total)  
* "Estimated total: 670." (forbidden modeling word in a non-total context)  
* "Projected total: \~1180." (predictive framing)  
* "Your section score scaled to a full SAT would be approximately 1340." (synthetic total)

### **9.4 Review for partial reports**

Per §6.2, `partial_scored` reports unlock review ONLY for sections that reach `submitted` state (`scoreable: true`). Sections in any other state are NOT review-eligible:

* The `/review/items` endpoint (§16) for a partial-scored session returns ONLY items from scoreable sections.  
* Requesting `/review/items/:question_id` for a question from a non-scoreable section returns `404 review_item_not_available` (§17).  
* The payload's `review_unlocked: true` indicates that SOME review is unlocked; clients MUST inspect `sections[].scoreable` to know which sections are reviewable.

---

## **10\. Failed scoring / `failed_requires_review` behavior**

This is the terminal-failure state. It surfaces when 04B's orchestrator hit a hard failure that prevented `score_runs` row insertion (V4.3 §19 hard failures: unattested version, integrity-constraint violation, etc.).

### **10.1 Derivation**

Per §5.3 \+ §2.5: `failed_requires_review` is the report state when `test_sessions.state IN ('completed', 'partial_scored_abandoned')` AND no `score_runs` row exists AND an open `exam_failure_ledger` entry exists for the session.

The dependency on 04D's failure ledger is explicit and locked by Parent V3.0 §10.2: 04C does NOT depend on `score_runs.SELECT` alone for the failed terminal state, because the unattested-version path produces no `score_runs` row.

### **10.2 Failed report payload**

type FailedExamReport \= {  
  report\_state: 'failed\_requires\_review';  
  session\_id: string;  
  test\_form\_id: string;  
  test\_form\_name: string;  
  completed\_at: string | null;       // null if session is partial\_scored\_abandoned  
  abandoned\_at: string | null;       // null if session is completed

  // No score block. The session has no scoreable result available.

  failure\_summary: {  
    student\_facing\_message: string;  // canonical copy from §10.4  
    incident\_reference: string;       // opaque token consumers can include in support tickets  
    recorded\_at: string;             // exam\_failure\_ledger.created\_at  
  };

  // Internal-only audit fields (admin payload only — see §10.5)  
  internal?: {  
    failure\_code: string;            // e.g., 'unattested\_scoring\_model\_version'  
    failure\_severity: 'info' | 'warning' | 'page' | 'critical';  
    failure\_status: 'open' | 'acknowledged';  
    related\_score\_run\_id: string | null;  
    related\_outbox\_id: string | null;  
  };

  review\_unlocked: false;  
};

### **10.3 Internal vs student-facing failure detail**

04C MUST NOT expose `failure_code`, `failure_severity`, `failure_status`, or `failure_message` (raw exception strings, version names, etc.) in student-facing or guardian-facing payloads. These are admin-only fields (§10.5).

Student-facing copy uses generic, supportive language (§10.4). The `incident_reference` token enables support to look up the underlying failure ledger entry without exposing the internal details.

**Incident reference generation.** `incident_reference` SHOULD be a short, URL-safe token derived from `exam_failure_ledger.id` (e.g., first 8 characters of the UUID prepended with `INC-`). It is NOT a secret — it is an audit handle. Support tooling MUST be able to resolve `incident_reference` to the full failure ledger entry.

### **10.4 Student-facing canonical copy (examples)**

Allowed (canonical examples; production copy Product-owned):

* "Your test score isn't available yet because of a technical issue on our end. Our team has been notified and is investigating. We'll email you when your score is ready. (Reference: INC-a1b2c3d4)"  
* "We weren't able to finalize the scoring for this attempt. This isn't related to your performance — our team is reviewing. We'll be in touch shortly. (Reference: INC-a1b2c3d4)"

Forbidden:

* "Scoring failed because the scoring model version v1.0 is unattested." (leaks internal cause)  
* "An unexpected error occurred at the orchestrator level." (leaks internal architecture)  
* "Your answers caused a scoring failure." (false attribution to the student)

### **10.5 Admin payload extension**

The admin-facing report endpoint (§16.4) MAY include the `internal` block on the failed payload, surfacing the full failure ledger entry to support / ops staff. This block MUST NOT appear in student or guardian payloads under any condition; serializer-level type narrowing enforces this.

### **10.6 No review unlock in failed state**

`review_unlocked` is `false` for all failed reports, regardless of whether the underlying answers exist in `test_session_answers`. The reasoning: review-surface anti-leak rules (§14) assume scoring produced a canonical correct/incorrect determination; a failed session has no such determination, and exposing review against ungraded answers is both UX-confusing and a potential anti-leak vector.

When the failure is resolved (ops fixes the underlying cause, 04B re-scores, `score_runs` row is inserted), the report state transitions to `scored` or `partial_scored` and review unlocks automatically on the next read per §5.5.

### **10.7 Transient vs permanent failures**

Per Parent V3.0 §10.2: 04C does NOT distinguish between transient retry-able failures and permanent misconfiguration failures by introducing a new state. Both surface as `failed_requires_review`. The distinction is internal (visible only in the `internal.failure_severity` and `internal.failure_status` fields exposed to admins).

This is intentional: the student does not benefit from knowing whether the issue is transient or permanent — they benefit from knowing it is not their fault, that ops is on it, and that they have a reference to provide to support. Internal severity classifications belong to 04D's operational surface.

---

## **11\. Student-safe report surface**

The student-safe payload is the canonical authoritative shape. Guardian and admin payloads derive from it via projection (§12 for guardian; §16.4 for admin).

### **11.1 Endpoint contract**

`GET /api/tests/sessions/:session_id/report`

Auth: student session token; ownership check (`test_sessions.student_id == authenticated student`).

The endpoint:

1. Authenticates the student session (Doc 01).  
2. Verifies entitlement (Doc 01 predicate covering full-length exams).  
3. Reads the session row; verifies ownership.  
4. Derives report state per §5.3.  
5. Constructs the state-specific payload (§8 / §9 / §10.2 / §11.4 / §11.5).  
6. Attaches disclosure (§15).  
7. Returns 200 with the payload.

Auth failures return per Doc 01 conventions (`401 unauthenticated`, `403 forbidden`). Per the V1.0 lock-cycle alignment split (§5.3, §16.6), session-not-found and ownership-mismatch are both classified as `never_existed` access and return `403 forbidden` with no body — there is no `404 session_not_found` code in 04C V1.0.

### **11.2 Payload-by-state matrix**

| `report_state` | HTTP | Payload shape | `review_unlocked` |
| ----- | ----- | ----- | ----- |
| `not_completed` | 200 | §11.4 minimal payload | `false` |
| `scoring_pending` | 200 | §11.5 pending payload | `false` |
| `scored` | 200 | §8 full payload | `true` |
| `partial_scored` | 200 | §9 partial payload | `true` (scoped per section, §6.2) |
| `failed_requires_review` | 200 | §10.2 failed payload | `false` |
| `voided` | 200 | §11.6 voided payload (MVP-reserved) | `false` |
| `unavailable` (revoked access) | 200 | §11.5b unavailable payload | `false` |
| (never-existed access) | 403 | No payload — `403 forbidden` per §16.6 anti-enumeration | (not applicable) |

The last two rows reflect the V1.0 lock-cycle alignment split (§5.3). `unavailable` is reachable as a 200-with-payload state ONLY when the requester has a current authorized relationship (current ownership for students; current active guardian-student link for guardians) but a specific gating condition is denying access. Never-existed access returns `403 forbidden` with no payload to prevent enumeration; the response does NOT carry `report_state: 'unavailable'`.

### **11.3 Strict serialization rule**

All payloads MUST be serialized through a single function per state that explicitly enumerates the included fields. There is no "default include everything" serializer. This is the same anti-leak posture as 04A V2.2 §10.2: forbidden fields are stripped, not omitted-by-convention.

function serializeStudentReport(  
  session: TestSession,  
  scoreRun: ScoreRun | null,  
  failureLedger: FailureLedgerEntry | null,  
  accessCheck: AccessCheckResult,  
  state: ReportState  
): StudentReportPayload {  
  // Anti-enumeration: never-existed access raises before any serialization.  
  // The HTTP layer translates this to 403 forbidden with no body.  
  if (\!accessCheck.granted && accessCheck.classification \=== 'never\_existed') {  
    throw new ForbiddenError();  
  }

  switch (state) {  
    case 'scored':                    return serializeScoredPayload(session, scoreRun\!);  
    case 'partial\_scored':            return serializePartialPayload(session, scoreRun\!);  
    case 'failed\_requires\_review':    return serializeFailedPayload(session, failureLedger\!);  
    case 'scoring\_pending':           return serializeScoringPendingPayload(session);  
    case 'not\_completed':             return serializeNotCompletedPayload(session);  
    case 'voided':                    return serializeVoidedPayload(session);  
    case 'unavailable':               return serializeUnavailablePayload(session, accessCheck);  
  }  
}

Type-level: the return type of each serializer is a distinct branch of `StudentReportPayload`, ensuring the compiler refuses any handler that would return mismatched fields. The `unavailable` case is now a real payload (§11.5b) returned with HTTP 200; the `never_existed` access classification short-circuits before serialization with HTTP 403\.

### **11.4 `not_completed` payload**

type NotCompletedReport \= {  
  report\_state: 'not\_completed';  
  session\_id: string;  
  test\_form\_id: string;  
  test\_form\_name: string;  
  session\_state: 'created' | 'active' | 'section\_break' | 'abandoned\_final';  
  resumable: boolean;       // true if session.state in ('created', 'active', 'section\_break') AND not past-grace  
  review\_unlocked: false;  
};

For a non-terminal session (resumable), `resumable: true` signals the consumer that the student can resume via the 04A runtime endpoints. For `abandoned_final` (terminal, no sections submitted), `resumable: false` and the client should render a "this attempt did not produce a result" surface.

### **11.5 `scoring_pending` payload**

type ScoringPendingReport \= {  
  report\_state: 'scoring\_pending';  
  session\_id: string;  
  test\_form\_id: string;  
  test\_form\_name: string;  
  completed\_at: string | null;  
  abandoned\_at: string | null;  
  estimated\_ready\_at: string | null;   // non-guaranteed operational estimate, NOT a promise (see semantics below)  
  review\_unlocked: false;  
};

`estimated_ready_at` is a UX nicety derived from 04D's outbox-publish-lag SLI (median or 95th percentile depending on Product preference). **It is a non-guaranteed operational estimate, NOT a commitment to the student.** Clients SHOULD render it with hedging copy (e.g., "usually ready by \~3:45 PM") and MUST NOT render it as a hard deadline. If 04D's SLI is unavailable, the field is `null` and the client renders a generic "Scoring usually takes a few minutes" message.

### **11.5b `unavailable` payload (revoked access — V1.0 lock-cycle alignment)**

Returned with HTTP 200 when the requester has a current authorized relationship (current ownership for students; current active guardian-student link for guardians) but a specific gating condition is denying access. Per §5.3 split:

type UnavailableReport \= {  
  report\_state: 'unavailable';  
  session\_id: string;  
  test\_form\_id: string;  
  test\_form\_name: string;  
  unavailable\_reason: 'entitlement\_lapsed' | 'guardian\_link\_inactive' | 'content\_takedown';  
  unavailable\_at: string | null;       // when access was revoked, if known; otherwise null  
  resume\_action: {  
    type: 'renew\_entitlement' | 'reactivate\_guardian\_link' | 'contact\_support';  
    url: string | null;                 // optional UX hint; may be null if no canonical URL exists  
  } | null;  
  review\_unlocked: false;  
};

**Field semantics:**

* `unavailable_reason`: discriminates between revocation causes so the client can render targeted copy. Drawn from the `accessCheck.reason` field set by Doc 01 / 04D predicates. **V1.0 note on `guardian_link_inactive`:** the enum value is reserved for future compatibility (when Doc 01 exposes historical guardian-link state). In V1.0, inactive or never-existed guardian links classify as `never_existed` access (HTTP 403, no body), NOT as `revoked`/`unavailable`. Only `entitlement_lapsed` and `content_takedown` are actively populated by V1.0 implementations.  
* `unavailable_at`: drawn from Doc 01 (entitlement lapse timestamp) or 04D (admin takedown timestamp) where the data exists; `null` when not tracked.  
* `resume_action`: optional Product-driven hint for what the user can do next. `null` if no canonical action is wired yet. The `url`, when present, MUST be safe to render as a click-through (no sensitive token exposure).

**Never-existed vs revoked distinction.** This payload is ONLY served when the access check classification is `revoked`. Never-existed access returns HTTP 403 with no body (§16.6). The two paths cannot be conflated: revealing `unavailable_reason` to a never-existed requester would leak that the session belongs to someone who is in the system.

**Forbidden fields in unavailable payload.** Same redaction list as §11.7 — no scores, no answers, no `module2_path`, no decomposition fields, no failure details. The payload conveys "you can't see this right now, here's why and what to do," nothing more.

### **11.6 `voided` payload (MVP-reserved)**

type VoidedReport \= {  
  report\_state: 'voided';  
  session\_id: string;  
  test\_form\_id: string;  
  test\_form\_name: string;  
  voided\_at: string;                  // from admin audit row  
  voided\_summary: {  
    student\_facing\_message: string;   // canonical copy  
    incident\_reference: string;        // for support follow-up  
  };  
  review\_unlocked: false;  
};

Implementation deferred to post-MVP. The shape is reserved in V1.0 so consumers can compile-time check exhaustiveness without a future breaking change. The `voided_summary.student_facing_message` MUST NOT leak the void reason or the voiding admin's identity to the student.

### **11.7 Field-level redaction (across all state-specific payloads)**

Regardless of which state is returned, the following fields MUST be redacted from any student-facing payload:

* `module2_path` (Invariant \#3)  
* `routing_threshold_rw`, `routing_threshold_m`, `routing_override_*`  
* Decomposition fields from `score_runs` (`rw_module1_correct`, etc.)  
* `source_outbox_event_id`  
* `failure_code`, `failure_severity`, `failure_status`, raw `failure_message`  
* Internal Doc 02 metadata not on the §13.4 review surface

A "field redaction" linter test SHOULD scan every serializer's return shape against this forbidden list and fail CI if any forbidden field appears in a non-admin payload type.

---

## **12\. Guardian-safe report surface**

Guardian payloads are a STRICT SUBSET of student payloads (Invariant \#7). Guardians see only fields the student also sees; never additional fields.

### **12.1 Endpoint contract**

`GET /api/guardian/students/:student_id/tests/:session_id/report`

Auth: guardian session token.

Steps:

1. Authenticate the guardian session (Doc 01).  
2. Read the session row. If no row exists OR `test_sessions.student_id != :student_id`: classify as `never_existed` → return `403 forbidden` (no body) per §16.6. This branch covers both "session doesn't exist" and "session belongs to a different student than the URL indicates" without distinguishing.  
3. Verify the current guardian-student link is active per Doc 01 (`guardian_has_active_link(guardian_id, student_id)` predicate). If false (link inactive OR never linked): classify as `never_existed` → return `403 forbidden` (no body). For V1.0, "link was once active, now inactive" is conservatively treated as `never_existed` to avoid requiring historical-link tracking; if Doc 01 later exposes link history, this branch can be refined to surface `unavailable` for the formerly-linked case (V1.1 candidate).  
4. Verify the student's full-length entitlement is active per Doc 01 (`student_has_active_full_length_entitlement(student_id)` predicate). If false: classify as `revoked` with `reason: 'entitlement_lapsed'` → return HTTP 200 with the `unavailable` payload (§11.5b). This is the V1.0 lock-cycle alignment per Karl's split: the guardian-student relationship exists and is current; the student-level entitlement is what was revoked, so guardian gets meaningful "your student's subscription is paused" copy instead of a bare 403\.  
5. Derive report state per §5.3 (using `accessCheck.granted = true`).  
6. Construct the student payload, then apply the guardian projection function (§12.2).  
7. Return HTTP 200 with the projected payload (or HTTP 403 for the `never_existed` early-return cases above).

### **12.1b Student endpoint access classification (for parity)**

For the student endpoint `GET /api/tests/sessions/:session_id/report`, the access classification follows the same split:

1. Authenticate; verify student role.  
2. Read the session. If no row OR `test_sessions.student_id != auth_student.id`: classify as `never_existed` → return `403 forbidden`.  
3. Verify the student's full-length entitlement is active per Doc 01\. If false: classify as `revoked` with `reason: 'entitlement_lapsed'` → return HTTP 200 with the `unavailable` payload (§11.5b).  
4. Proceed with derivation per §5.3.

This is the symmetric application of the V1.0 split to both endpoint families. Ownership-mismatch is always `never_existed` (anti-enumeration); active-then-lapsed entitlement is always `revoked` (carries actionable copy).

### **12.2 Guardian projection function**

The guardian projection is a strict subset operation:

function projectStudentReportForGuardian(  
  studentReport: StudentReportPayload  
): GuardianReportPayload {  
  // Returns the same payload with the following fields removed regardless of state:  
  // \- sections\[\].incompleteness\_reason (UX-internal; guardian sees the section state instead)  
  // \- estimated\_ready\_at (UX hint specific to the student's polling experience)  
  // \- resumable (guardian cannot resume; field is meaningless)  
  // The state discriminator and all score-bearing fields are preserved.  
  return omit(studentReport, \[  
    'sections\[\].incompleteness\_reason',  
    'estimated\_ready\_at',  
    'resumable',  
  \]);  
}

This minimal redaction set reflects Parent V3.0 §15's principle: guardians see outcomes, not operational mechanics. The student's view includes UX-internal hints; the guardian's does not.

### **12.3 What guardians explicitly cannot do**

* Cannot resume a session (no `POST /api/tests/...` access).  
* Cannot access the review surface (§13). The `/review/items` and `/review/items/:question_id` endpoints reject guardian tokens with `403 forbidden`.  
* Cannot see tutor conversations associated with the session (owned by Doc 03; out of scope for 04C).  
* Cannot see internal failure details on failed reports (`internal` block is admin-only per §10.5).  
* Cannot trigger any state change (no view-tracking writes, no acknowledgements that influence student state).

### **12.4 Multi-student guardians**

A guardian with multiple linked students MUST authenticate per request with the student context (URL path). 04C does NOT serve an aggregated multi-student endpoint. If Product wants a "guardian dashboard" with multi-student rollup, that is a separate aggregation layer owned by Doc 01 or a future dashboard doc — NOT by 04C.

### **12.5 Guardian view-tracking**

Same V1.0 stance as §4.4: no canonical view-tracking writes from 04C. If Product wants "guardian last viewed at" on the dashboard, it goes through 04D audit events (`guardian_exam_report_requested`, `guardian_exam_report_returned` per Karl's taxonomy), not through a column on `test_sessions`.

---

## **13\. Post-completion question review**

The review surface exposes per-question detail (stem, options, the student's answer, the correct answer, the explanation, domain / skill metadata) AFTER review unlock. This is the transition out of 04A's pre-submit anti-leak posture.

### **13.1 Endpoints**

`GET /api/tests/sessions/:session_id/review`

Returns the review-eligible question list with summary correctness, ordered by section \+ module \+ ordinal.

`GET /api/tests/sessions/:session_id/review/items`

Returns the full review payload for all review-eligible items in one call (paginated if the form has many items; MVP default: single payload covering both sections).

`GET /api/tests/sessions/:session_id/review/items/:question_id`

Returns the full review payload for a single item by `question_id`.

All three endpoints share the same precondition: `reviewUnlocked(reportState) == true` (§6.1) AND `test_form_items` contains a matching `(test_form_id, section, module, ordinal, question_id)` row.

### **13.2 Per-item review payload**

type ReviewItem \= {  
  section: 'RW' | 'M';  
  module: '1' | '2A' | '2B';  
  ordinal: number;  
  question\_id: string;  
  question\_type: 'multiple\_choice' | 'student\_produced\_response';  
  stem: string;  
  options: Array\<{ label: 'A' | 'B' | 'C' | 'D'; text: string }\>;  
  assets: Array\<{ type: 'image' | 'passage' | 'chart'; url: string; alt: string }\>;

  student\_answer: string | null;  
  correct\_answer: string;              // canonical single correct answer  
  correct\_variants: string\[\];          // additional accepted equivalents (e.g., for student-produced response)  
  was\_correct: boolean;                // derived via the shared is\_answer\_correct comparator  
  was\_omitted: boolean;                // true if student\_answer is null

  explanation: string;  
  domain: string;  
  skill\_code: string;  
  difficulty: number;                  // 1-5 or whatever Doc 02 emits  
};

### **13.3 Section eligibility (recap)**

Per §6.2 \+ §9.4:

* `scored` state: both sections review-eligible.  
* `partial_scored` state: only sections with `section_state = 'submitted'` AND `scoreable: true` are review-eligible. Other sections return `404 review_item_not_available` (§17) or are omitted from `/review/items` list responses.  
* All other states: review is locked entirely; all three endpoints return `403 review_locked` (§17).

### **13.4 Anti-leak rules for review surface**

Review payloads MAY include:

* `correct_answer`, `correct_variants` (the answer set 04B's `is_answer_correct` comparator checks against)  
* `explanation` (Doc 02 authoring)  
* `domain`, `skill_code`, `difficulty`

Review payloads MUST NOT include:

* `module2_path` or any signal of routing (Invariant \#3)  
* Internal authoring notes from Doc 02 (e.g., editor comments, QA flags)  
* Distractor taxonomy metadata (which distractor a particular wrong option targets)  
* Internal Doc 02 fields not enumerated in §13.2

The serializer enforces this with the same single-function-per-shape pattern as §11.3.

### **13.5 Adjacent-form leak prevention**

A review item exposes `correct_answer` for the question\_id served. If the same question appears on another form (forms MAY share questions per Doc 02 reuse), this trivially reveals the answer for that other form too. This is acceptable for MVP because:

* 04A V2.2 §5.2 already constrains `(test_form_id, question_id)` UNIQUE per form — a question appears at most once per form.  
* Form-to-form question reuse is a Content authoring decision; Content is aware that review unlock reveals answers across forms that share questions.  
* If a future revision wants to enforce strict per-form answer isolation, the constraint belongs in Doc 02 / Content tooling (e.g., "no question may appear on more than one published form"), not in 04C.

V1.0 documents this so it cannot be discovered later as a surprise.

### **13.6 Tutor coordination during review (Doc 03\)**

When a student is in review mode, Doc 03's tutor MAY be invoked for a question. The tutor's anti-leak rules are owned by Doc 03 (per the tutor runtime contract uploaded with this project). 04C's review payload is a read-only surface; the tutor reads from it but does not write back. Tutor mastery interactions during review do not affect mastery (per Doc 03 contract); they are pedagogical scaffolding only.

---

## **14\. Explanation visibility and anti-leak rules**

This section is the policy underlying §13's payload contract. It defines when which Doc 02 fields can appear in 04C-owned responses.

### **14.1 Anti-leak posture by report state**

| Report state | `correct_answer`, `correct_variants` | `explanation` | `domain`, `skill_code`, `difficulty` |
| ----- | ----- | ----- | ----- |
| `not_completed` | NEVER | NEVER | NEVER |
| `scoring_pending` | NEVER | NEVER | NEVER |
| `scored` | Allowed in review (§13.4) | Allowed in review (§13.4) | Allowed in review (§13.4) |
| `partial_scored` | Allowed in review for scoreable sections only (§13.3) | Allowed in review for scoreable sections only | Allowed in review for scoreable sections only |
| `failed_requires_review` | NEVER | NEVER | NEVER |
| `voided` | NEVER | NEVER | NEVER |
| `unavailable` | NEVER | NEVER | NEVER |

**Important caveat for `unavailable` (V1.0 lock-cycle alignment).** The report endpoint MAY return HTTP 200 with the `unavailable` payload (§11.5b) for revoked-access cases. That payload carries `unavailable_reason`, `unavailable_at`, and optional `resume_action` — but NO answer-bearing or explanation-bearing fields. The anti-leak posture above is absolute regardless of whether the endpoint returned 200 or 403: in NO `unavailable` response (under either HTTP status) do `correct_answer`, `correct_variants`, `explanation`, `domain`, `skill_code`, or `difficulty` appear.

The `NEVER` cells are absolute. There is no admin escape; there is no debug flag; there is no edge case. If review is not unlocked for a section, that section's `correct_answer` MUST NOT travel to ANY consumer payload (student, guardian, admin) through any 04C endpoint.

### **14.2 Admin override is constrained**

Admin payloads (§16.4) MAY include the `internal` block on failed reports (§10.5) and decomposition fields on scored reports, but admin payloads are STILL bound by §14.1's review-unlock rule for `correct_answer` / `explanation`. The reason: admin debugging of a failed-scoring incident does not require seeing the correct answers; it requires seeing the failure metadata. Decoupling admin access to operational metadata from admin access to anti-leak-protected content keeps the principle of least privilege intact.

If a specific admin workflow ever needs `correct_answer` access for an unscored session (e.g., "validate that question authoring was correct"), that access path is owned by Doc 02 / Content tooling, NOT by 04C's review endpoint.

### **14.3 Cache invalidation on lock-to-unlock transition**

When a session transitions from `scoring_pending` to `scored` (the most common review-unlock trigger), any client-side caches of "review locked" state become stale. The recommended pattern:

* Clients SHOULD use HTTP cache headers with short max-age (e.g., 30 seconds) on `/report` while in `scoring_pending` state, so subsequent polls re-fetch and surface the unlock promptly.  
* Once `scored`, clients MAY cache the report payload aggressively (it is canonical and stable; only an entitlement change invalidates it).  
* 04C SHOULD set `Cache-Control: private, max-age=30` for `scoring_pending` responses and `Cache-Control: private, max-age=300` (or similar) for `scored` responses. Production tuning is operational; the SHOULD-level guidance is non-blocking.

### **14.4 Adjacent-system anti-leak coordination**

04C is not the only system that can reveal answers post-completion. Coordination:

* **04A** (runtime): MUST NOT change post-completion question payloads to include answers — its `/items` endpoint serves active-module payloads only (04A V2.2 §10.1 verifies module is active).  
* **Doc 02** (question source): MUST NOT have a "public" endpoint that exposes answers without an authenticated review-unlock check.  
* **Doc 03** (tutor): MUST NOT reveal answers during scoping into a still-active session per its own anti-leak rules (uploaded tutor runtime contract).  
* **04D** (audit): MUST NOT log raw answer values or correct-answer values in audit events (Karl's taxonomy lists field names but not values).

This document is not the canonical owner of these other systems' rules — they own their own rules — but listing them here ensures the cross-doc anti-leak surface is auditable.

---

## **15\. Modeled-score disclosure requirements**

Disclosure is the canonical framing that every scaled score carries: Lyceon's scores are modeled estimates aligned with a third-party DSAT benchmark calculator, NOT certified-official SAT scores. Parent V3.0 §7.4 and §12 lock the discipline; this section operationalizes it.

### **15.1 Disclosure is part of the payload, not a UI concern**

Every report payload that contains a scaled score MUST include a `disclosure` block with three fields (per §8.1 and §9.1):

type DisclosureBlock \= {  
  disclosure\_version: string;        // canonical version identifier  
  summary: string;                   // short canonical phrase  
  full\_text\_url: string;             // link to the full disclosure document  
};

Clients MAY render the `summary` inline with the score and the `full_text_url` as a "Learn more" link. Clients MUST NOT render a scaled score without rendering the `summary` adjacent to it.

### **15.2 Disclosure version binding**

Each `score_run` is implicitly bound to a disclosure version, derived from its `scoring_model_version`. 04C MUST resolve the bound disclosure version at read time (NOT compute a "current disclosure version" that may have changed since scoring).

The binding mechanism is a table keyed by `scoring_model_version`:

CREATE TABLE score\_disclosure\_versions (  
  scoring\_model\_version text PRIMARY KEY REFERENCES scoring\_model\_versions(version),  
  disclosure\_version    text NOT NULL,  
  summary               text NOT NULL,  
  full\_text\_url         text NOT NULL,  
  activated\_at          timestamptz NOT NULL DEFAULT clock\_timestamp(),  
  superseded\_at         timestamptz NULL  
);

CREATE INDEX idx\_score\_disclosure\_versions\_by\_version  
  ON score\_disclosure\_versions (disclosure\_version);

The primary key is `scoring_model_version`, which ensures exactly one disclosure binding per scoring model version. `disclosure_version` is NOT unique — multiple scoring model versions MAY share the same disclosure copy (e.g., v1.0 and v1.1 both pointing at `disclosure-2026.05` when the scoring math change is too small to warrant a copy revision). The index supports lookup by `disclosure_version` for audit / content-management queries.

When a new scoring model version activates, a new disclosure version SHOULD be authored if the underlying scoring approach has changed in a way that affects student-facing framing. The 04B form-publish gate (04A V2.2 §6.2) already ensures forms bind only to active scoring versions, so authoring discipline cascades from there.

**V1.0 ownership (alignment-confirmed).** This table is owned by 04C V1.0 (this document). Authoring of `summary` and `full_text_url` content lives with Content / Legal; 04C reads.

### **15.3 Forbidden disclosure phrases (canonical)**

`summary` and `full_text_url`\-linked content MUST NOT contain the following phrases or close synonyms:

* "Official SAT score"  
* "College Board score"  
* "Equivalent to an SAT score of"  
* "Guaranteed score range"  
* "Your projected SAT score"  
* "This is your SAT score"  
* "Predicts your future SAT performance with confidence"

`summary` MUST contain language matching at least one of these canonical templates (Content owns the exact wording):

* "Lyceon-modeled estimate, not an official SAT score"  
* "Practice-aligned estimate, not certified by College Board"  
* "Modeled readiness signal, aligned with a third-party DSAT benchmark"

### **15.4 Disclosure on partial-scored reports**

Partial-scored reports carry TWO disclosure blocks per §9.1:

* `disclosure`: the standard modeled-score disclosure (§15.1).  
* `partial_disclosure`: an additional block explaining why no total score is available.

The `partial_disclosure.summary` MUST satisfy invariant \#2 (no total framing) per §9.3.

Failed and pending reports do NOT include `disclosure` blocks because they have no scaled score to qualify. The `failed_requires_review` payload uses the `failure_summary` block instead (§10.2).

### **15.5 Disclosure render checklist (informational for client teams)**

Clients SHOULD ensure:

1. The `summary` text is rendered adjacent to (above, below, or next to) every visible scaled score.  
2. The `full_text_url` is rendered as a visible, clickable link (or an equivalent affordance for non-web clients).  
3. The disclosure text is NOT collapsed into a tooltip or hidden behind a "more info" expansion that the student must trigger.  
4. The disclosure does NOT travel through the same UI element as the scaled score (e.g., the disclosure SHOULD NOT be inline-text inside the score component itself, which clients may format heavily and could visually de-emphasize).

These are SHOULD-level recommendations; the canonical 04C contract is that the `disclosure` block is in the payload. Client rendering discipline is a Product / UX concern.

---

## **16\. API surface**

This section catalogs all 04C-owned HTTP endpoints. Every endpoint runs the standard precondition chain (§16.5) before any state-specific logic.

### **16.1 Student endpoints**

| Method | Path | Purpose |
| ----- | ----- | ----- |
| `GET` | `/api/tests/sessions/:session_id/report` | Read the full report payload for a session (state-discriminated) |
| `GET` | `/api/tests/sessions/:session_id/report/status` | Lightweight read returning just `{ report_state, review_unlocked, estimated_ready_at? }` — for polling while in `scoring_pending` |
| `GET` | `/api/tests/sessions/:session_id/review` | List review-eligible items (summary correctness only) |
| `GET` | `/api/tests/sessions/:session_id/review/items` | Full review payload for all eligible items |
| `GET` | `/api/tests/sessions/:session_id/review/items/:question_id` | Full review payload for a single item |

### **16.2 Guardian endpoints**

| Method | Path | Purpose |
| ----- | ----- | ----- |
| `GET` | `/api/guardian/students/:student_id/tests/:session_id/report` | Read the guardian-projected report payload (§12.2) |
| `GET` | `/api/guardian/students/:student_id/tests/:session_id/report/status` | Guardian polling variant; returns the projected status block |

Guardians do NOT have access to `/review` or `/review/items` endpoints (§12.3). Attempting these returns `403 forbidden`.

### **16.3 Multi-session listing (optional MVP, deferred to V1.1)**

V1.0 does not include a "list all my exam reports" endpoint. Clients construct this by listing `test_sessions` (owned by 04A, separate listing endpoint) and calling `/report/status` per session. If Product wants an aggregated endpoint, V1.1 adds it as a projection over the same canonical data.

### **16.4 Admin endpoints**

| Method | Path | Purpose |
| ----- | ----- | ----- |
| `GET` | `/api/admin/tests/sessions/:session_id/report` | Read the admin report payload (includes decomposition fields on scored, `internal` block on failed) |
| `GET` | `/api/admin/tests/sessions/:session_id/report/raw` | Read the full canonical join (debug surface — wraps the §4.2 view) |
| `GET` | `/api/admin/tests/sessions/:session_id/review/items` | Admin review payload (same anti-leak rules per §14.2 — only review-unlocked sections expose answers) |

Admin endpoints require an admin role per Doc 01\. They are NOT public student/guardian endpoints with a "magic flag."

### **16.5 Standard precondition chain**

Every 04C endpoint runs these checks in order, before any state-specific logic:

1. **Authentication.** Verify the request carries a valid Doc 01 session token. Fail → `401 unauthenticated`.  
2. **Role check.** Student endpoints require student role; guardian endpoints require guardian role; admin endpoints require admin role. Fail → `403 forbidden`.  
3. **Session existence.** Read `test_sessions` by `session_id`. If no row exists, classify the request as `never_existed` access (§5.3) and proceed to step 4 — do NOT short-circuit to `404`; the unified anti-enumeration response is HTTP 403 (step 5).  
4. **Ownership / link classification.** Determine the access classification per §5.3:  
   * Student endpoints: if `test_sessions.student_id != auth_student.id` OR session does not exist → `never_existed`.  
   * Guardian endpoints: per §12.1 steps 2–3 — if session is missing, belongs to a different student, or current guardian-student link is inactive → `never_existed`.  
   * Admin endpoints: admin role bypasses ownership; skip to step 6\.  
5. **Access classification dispatch.**  
   * `never_existed` → return `403 forbidden` with no state-bearing body. Do NOT include `report_state: 'unavailable'`; the bare 403 prevents enumeration.  
   * `revoked` (current relationship exists, entitlement or content access is currently denied) → return HTTP 200 with the `unavailable` payload (§11.5b) carrying the revocation reason. This branch is reachable from §12.1 step 4 (guardian) and §12.1b step 3 (student).  
   * `granted: true` → proceed to step 6\.  
6. **Report-state derivation.** Run §5.3 derivation to determine the state.  
7. **State-specific serialization.** Construct the appropriate payload per §11.3.  
8. **Audit emission.** Emit the appropriate 04D audit event (`exam_report_requested`, `exam_report_returned`, `guardian_exam_report_requested`, etc. per Karl's audit taxonomy). Audit emission failures are non-blocking; the payload still returns. Per invariant \#8 (V1.0 lock-cycle clarification), these are non-canonical observability events; no downstream system treats them as state.

### **16.6 Access classification under anti-enumeration (V1.0 lock-cycle alignment)**

The two classifications of unauthorized access map to two distinct HTTP responses per Karl's V1.0 lock-cycle decision and RB-04C-V1-03 resolution:

| Situation | Classification | HTTP response | Body |
| ----- | ----- | ----- | ----- |
| Session does not exist (no row) | `never_existed` | `403 forbidden` | `{ error: { code: 'forbidden', message: ... } }` — no `report_state`, no session details |
| Student endpoint, session belongs to another student | `never_existed` | `403 forbidden` | same as above |
| Guardian endpoint, guardian-student link is currently inactive (or never existed) | `never_existed` | `403 forbidden` | same as above |
| Guardian endpoint, link active but session does not belong to the linked student | `never_existed` | `403 forbidden` | same as above |
| Student endpoint, ownership correct but student entitlement is currently inactive | `revoked` (`entitlement_lapsed`) | `200 OK` | `unavailable` payload (§11.5b) with `unavailable_reason: 'entitlement_lapsed'` |
| Guardian endpoint, link active but student entitlement is currently inactive | `revoked` (`entitlement_lapsed`) | `200 OK` | `unavailable` payload (§11.5b) |
| Admin-issued content takedown affecting the session | `revoked` (`content_takedown`) | `200 OK` | `unavailable` payload (§11.5b) with `unavailable_reason: 'content_takedown'` |

**Anti-enumeration property.** A probing requester (trying random session IDs to discover which exist) sees `403 forbidden` for both "session doesn't exist" and "session exists but you have no relationship." The two responses are indistinguishable, so probing reveals nothing about existence. Karl's choice of `403` over `404` for never-existed cases is the V1.0 lock-cycle decision; it differs from the V1.0 draft's "always 404" stance but achieves the same anti-enumeration goal.

**Why split revoked into 200 instead of 403\.** A `revoked` response carries actionable information (`unavailable_reason`, optional `resume_action`) that helps the user understand what happened and what they can do. This information is only safe to expose to a requester who has a current authorized relationship — never-existed requesters get the bare 403 instead. The split is the alignment-confirmed V1.0 contract.

**Future refinement (out of scope for V1.0).** Distinguishing "guardian was once linked, now unlinked" (which could surface as `unavailable` with `reason: 'guardian_link_inactive'`) from "guardian was never linked" (which surfaces as `never_existed` → 403\) requires historical-link tracking in Doc 01\. V1.0 treats both as `never_existed` for simplicity; V1.1 may refine if Doc 01 exposes link history.

### **16.7 Standard error codes**

| Code | HTTP | When |
| ----- | ----- | ----- |
| `unauthenticated` | 401 | No valid session token |
| `forbidden` | 403 | Authenticated but lacks required role; OR access classification is `never_existed` per §16.6 (session doesn't exist, ownership mismatch, no guardian link, etc. — unified anti-enumeration response) |
| `report_not_yet_available` | 409 | (Reserved) For endpoints that require a scored report (e.g., review surface) when state is `scoring_pending` |
| `review_locked` | 403 | Review surface requested but `review_unlocked = false` for the session |
| `review_item_not_available` | 404 | Specific review item requested but its section is not review-eligible (§9.4). This is the only 404 code in V1.0 — it indicates a valid session with a valid review unlock but an invalid item within that scope, so existence-vs-access enumeration does not apply. |
| `report_data_integrity_violation` | 500 | Defensive: invariant violation detected upstream (e.g., duplicate `score_runs` rows per §7.4, or missing `score_disclosure_versions` row per §17) |

The `unavailable` state is NOT an error code — it returns HTTP 200 with the `unavailable` payload (§11.5b). The `session_not_found` code present in the V1.0 draft has been removed; per Karl's V1.0 lock-cycle alignment, both "session doesn't exist" and "you have no relationship" return the unified `403 forbidden` to prevent enumeration.

`report_data_integrity_violation` is the only 500-class error 04C returns deliberately. It indicates an invariant violation in upstream data that 04C cannot recover from at read time; the response triggers a `report_data_integrity_violation` 04D audit event for immediate operational attention.

### **16.8 Response envelope**

All 04C endpoints return responses in this envelope:

{  
  "data": { ... payload ... },  
  "meta": {  
    "request\_id": "uuid",  
    "served\_at": "2026-05-12T16:00:00Z"  
  }  
}

For error responses:

{  
  "error": {  
    "code": "review\_locked",  
    "message": "Review is not available for this report yet.",  
    "details": { ... optional structured payload ... }  
  },  
  "meta": {  
    "request\_id": "uuid",  
    "served\_at": "2026-05-12T16:00:00Z"  
  }  
}

The `request_id` is the canonical correlation ID for 04D audit cross-referencing. `served_at` is the server's `clock_timestamp()` at serialization start.

---

## **17\. Failure modes**

| Failure | Handling |
| ----- | ----- |
| Session does not exist | Classify as `never_existed`; return `403 forbidden` with no body per §16.6 (V1.0 anti-enumeration) |
| Student requests another student's session | Classify as `never_existed`; return `403 forbidden` (anti-enumeration, §16.6) |
| Guardian link inactive (or never existed) | Classify as `never_existed`; return `403 forbidden` per §12.1 step 3 |
| Student entitlement lapsed (auth student is session owner) | Classify as `revoked` with `reason: 'entitlement_lapsed'`; return `200` with the `unavailable` payload (§11.5b) per §12.1b step 3 |
| Guardian link active but student entitlement lapsed | Classify as `revoked` with `reason: 'entitlement_lapsed'`; return `200` with the `unavailable` payload per §12.1 step 4 |
| Admin content takedown applied to a session | Classify as `revoked` with `reason: 'content_takedown'`; return `200` with the `unavailable` payload |
| `test_sessions.state = completed` but no `score_runs` and no failure ledger entry | Report state is `scoring_pending`; return §11.5 payload; consumer polls |
| `test_sessions.state = completed` and `score_runs` exists | Report state is `scored`; return §8 payload |
| `test_sessions.state = completed` and no `score_runs` and open failure ledger entry exists | Report state is `failed_requires_review`; return §10.2 payload with incident reference |
| `test_sessions.state = partial_scored_abandoned` and `score_runs.partial_display_scaled IS NOT NULL` | Report state is `partial_scored`; return §9.1 payload |
| `test_sessions.state = abandoned_final` (no sections submitted) | Report state is `not_completed`; return §11.4 payload with `resumable: false` |
| Duplicate `score_runs` rows detected for one session | Return `500 report_data_integrity_violation`; emit 04D audit event; do NOT pick one row (§7.4) |
| `exam_failure_ledger` row exists in `resolved` status only | NOT a failure state; report is derived from `score_runs` alone. If `score_runs` was inserted post-resolution, state is `scored` or `partial_scored`. If not (resolution did not produce a `score_runs` row), state falls back to `scoring_pending` (operational re-run pending). |
| Guardian session token presents student URL path | Reject with `403 forbidden` (wrong-role check at §16.5 step 2\) |
| Review requested for non-scoreable section in partial-scored session | `404 review_item_not_available` for the item, OR omit from list responses (§9.4) |
| Doc 02 question fetch fails (transient infra) | Return `503 service_unavailable` with retry hint; do NOT serve a stale or empty `correct_answer` |
| Doc 01 entitlement predicate returns inconsistent results within a single request | 04C MUST cache the result per request (one call per endpoint invocation); cross-request inconsistency is acceptable (a lapse mid-session-flow surfaces on the next read) |
| 04D audit emission fails | Non-blocking; the report payload still returns; the audit failure is itself logged via 04D's fallback mechanism (out of scope for 04C) |
| Scoring model version transitions from `active` to `superseded` between scoring and report read | No effect on 04C — the `score_runs.scoring_model_version` is captured at scoring time and carried forward in the payload; current version state does NOT influence display |
| `score_runs.scoring_model_version` resolves to a `disclosure_version` that does not exist in `score_disclosure_versions` | Return `500 report_data_integrity_violation`; emit 04D audit event (`disclosure_version_missing`); do NOT serve a payload without a disclosure block (Invariant \#4) |
| Concurrent score-run insertion during read | 04C reads with READ COMMITTED isolation; a score-run that commits mid-read either appears in the next read or this one — the derivation function is idempotent either way (§5.5) |

---

## **18\. Transaction boundaries**

04C is read-mostly. There is one operation that writes (potentially) — the optional view-tracking pattern in §4.4, deferred to 04D in V1.0. So this section is intentionally short.

| Operation | Reads | Writes | Atomicity |
| ----- | ----- | ----- | ----- |
| `GET /report` (any state) | `test_sessions`, `test_session_sections`, optional `score_runs`, optional `exam_failure_ledger`, Doc 01 entitlement predicate | (none) | Read-only; READ COMMITTED isolation; consistent within a single SQL statement set |
| `GET /report/status` | Same as `/report` but narrower projection | (none) | Read-only |
| `GET /review`, `/review/items`, `/review/items/:question_id` | `test_sessions`, `test_session_sections`, `test_form_items`, `test_session_answers`, Doc 02 questions, optional `score_runs` | (none) | Read-only |
| 04D audit emission (§16.5 step 8\) | (none from 04C's perspective) | 04D audit-event row (owned by 04D) | Best-effort; non-blocking per §17 |

**No write contention with upstream.** Because 04C does not write to any 04A or 04B table, it cannot cause write contention with the runtime or scoring pipelines. Read load against `score_runs` and `test_session_answers` is the only operational concern; §4.5 lists the indexes that handle this load.

---

## **19\. Acceptance criteria**

This document is satisfied when:

1. The `ReportState` enum (§5.1) is implemented exactly as specified, including the two MVP-reserved states (`voided`, `unavailable`).  
2. The derivation function (§5.3) is implemented as a pure function whose inputs are the listed canonical sources; integration tests verify that every state in the enum is reachable via the documented trigger conditions (§5.4).  
3. Report state is NEVER persisted in a column or cache that outlives a single request handler (Invariant \#6); changes in upstream state are immediately reflected on the next read.  
4. The full report payload (§8) excludes ALL fields enumerated in §11.7 (`module2_path`, routing thresholds, decomposition fields, `source_outbox_event_id`, raw failure details, internal Doc 02 metadata) under every code path serving a student / guardian payload.  
5. The partial report payload (§9) ALWAYS has `score.total_scaled = null` (Invariant \#2); integration tests verify this for every partial-scored fixture.  
6. The failed report payload (§10.2) uses generic student-facing copy and exposes only the opaque `incident_reference` token; raw `failure_code`, `failure_message`, `failure_severity` MUST NOT appear in non-admin payloads.  
7. Review unlock is governed exclusively by the predicate in §6.1 (`scored` or `partial_scored`); no other condition (entitlement extra, time elapsed, disclosure acknowledgement) gates unlock.  
8. Review eligibility per section in `partial_scored` matches scoreability per 04A V2.2 invariant \#16 (only `submitted` sections); `module1_submitted` sections are NEVER review-eligible (§6.3).  
9. The guardian projection function (§12.2) is implemented as a strict-subset operation; an enforcement test verifies that the guardian payload field set is always a subset of the student payload field set (Invariant \#7).  
10. The disclosure block (§15) is present in every payload containing a scaled score; the `disclosure_version` resolves to a real row in `score_disclosure_versions` bound to the scoring model version of the underlying `score_run`.  
11. Forbidden disclosure phrases (§15.3) are never present in any served `summary` text; a content-linter test scans `score_disclosure_versions.summary` rows and fails CI on any violation.  
12. Anti-leak rules (§14.1) hold absolutely: `correct_answer`, `correct_variants`, `explanation`, `domain`, `skill_code`, `difficulty` MUST NOT travel through any 04C-owned endpoint when the requesting session state is not `scored` or `partial_scored`.  
13. The access classification split (§5.3, §16.6) is implemented per the V1.0 lock-cycle alignment: `never_existed` requests (no session, ownership mismatch, no guardian link) return `403 forbidden` with no body; `revoked` requests (entitlement lapsed, content takedown — relationship is current) return `200` with the `unavailable` payload (§11.5b) carrying `unavailable_reason` and optional `resume_action`. Integration tests verify that probing for non-existent session IDs is indistinguishable (response-wise) from probing for sessions the requester is not related to.  
14. The `unavailable` state, when returned as HTTP 200, exposes only `unavailable_reason`, `unavailable_at`, and `resume_action` (per §11.5b); no scores, no answers, no `module2_path`, no decomposition fields, no failure-ledger details appear.  
15. The duplicate-`score_runs` defensive check (§7.4) is implemented and returns `500 report_data_integrity_violation` \+ a 04D audit event without picking a row arbitrarily.  
16. The disclosure-version-binding check (`score_runs.scoring_model_version` → `score_disclosure_versions.scoring_model_version`) is implemented; missing binding returns `500 report_data_integrity_violation` \+ a 04D audit event (Invariant \#4 cannot be silently bypassed by a missing disclosure row).  
17. View-tracking writes (§4.4) are NOT implemented on canonical tables in V1.0; analytics flow through 04D audit events only.  
18. The endpoint precondition chain (§16.5) executes in the documented order; integration tests verify ordering by injecting failures at each step and asserting the corresponding error code.

---

## **20\. Cross-doc contract summary**

This section is a compact reference for engineers building against 04C. It does not introduce new contracts — it summarizes what was established elsewhere in this document.

### **20.1 What 04C reads**

test\_sessions                    (04A V2.2 §5.3)  
test\_session\_sections            (04A V2.2 §5.4)  
test\_form\_items                  (04A V2.2 §5.2)  
test\_session\_answers             (04A V2.2 §5.6)  
test\_forms                       (04A V2.2 §5.1; admin display only)  
score\_runs                       (04B V4.3 §9)  
scoring\_model\_versions           (04B V4.3 §7.2; for version → disclosure mapping)  
questions, explanations          (Doc 02; for review surface only)  
exam\_failure\_ledger              (04D pending)  
Doc 01 entitlement predicate  
Doc 01 guardian\_can\_view\_student\_report predicate  
score\_disclosure\_versions        (04C V1.0 owns this table per §15.2)

### **20.2 What 04C writes**

score\_disclosure\_versions        (authored content; not in the read-of-a-report path)  
04D audit events                 (via 04D's emission interface; non-blocking per §17)

V1.0 stance: 04C writes nothing in the request path of a report read. The only write is to `score_disclosure_versions` during disclosure authoring (operational, not runtime).

### **20.3 What 04C emits to other systems**

04D audit events per Karl's taxonomy (§16.5 step 8):  
  exam\_report\_requested  
  exam\_report\_returned  
  exam\_report\_pending\_returned  
  exam\_report\_failed\_requires\_review\_returned  
  exam\_review\_unlocked  
  exam\_review\_item\_viewed  
  guardian\_exam\_report\_requested  
  guardian\_exam\_report\_returned  
  report\_data\_integrity\_violation  (new per §7.4)  
  disclosure\_version\_missing       (new per §17)

These are emitted into 04D's audit-event surface. 04C does not own their schema; 04D enumerates them.

### **20.4 What 04C does NOT own**

score computation (04B V4.3)  
session state machine (04A V2.2)  
audit-event schema and taxonomy (04D pending)  
question authoring (Doc 02\)  
mastery formula (Doc 05\)  
entitlement / role / guardian-link storage and predicates (Doc 01\)  
tutor coordination (Doc 03\)

### **20.5 04C → 04D handoff for failed-state display**

The critical seam: when 04B's orchestrator fails permanently, 04C reads from 04D's `exam_failure_ledger` to determine whether to surface `failed_requires_review`. The handoff:

04B raises (V4.3 §19 hard failure) → 04D writes exam\_failure\_ledger row (status='open')  
                                       ↓  
04C read derivation function (§5.3) checks for the open ledger entry  
                                       ↓  
04C returns failed\_requires\_review payload with incident\_reference (§10.2)

If 04D has not yet been drafted at the time of 04C implementation, the `exam_failure_ledger` table is the contract surface — its minimal shape MUST contain `(test_session_id, status, created_at, id)` for 04C's derivation to work. 04D's V1.0 will likely expand this with `source`, `failure_code`, `failure_message`, `severity`, `related_outbox_id`, etc., but the 04C-required minimum is the four fields above plus `failure_code` (for incident reference generation in §10.3).

### **20.6 04C → Doc 05 handoff (none)**

Per Parent V3.0 RB-V3-07 \+ RB-V3-08 and 04A V2.2 §3.1: Doc 05 reads canonical answer state from `test_session_answers JOIN questions` directly. **04C is not part of Doc 05's read path.** When Doc 05 is drafted, it MUST NOT take a dependency on 04C's payloads or endpoints; if it does, that is a design error to flag during Doc 05 review.

---

## **21\. Change Records**

| Version | Date | Reviewer | Summary | Source |
| ----- | ----- | ----- | ----- | ----- |
| V1.0 | 2026-05-12 | Karl \+ Claude | Initial canonical draft. Establishes the `ReportState` enum (renaming Parent V3.0 §10's sketch states and adding two MVP-reserved states `voided`/`unavailable`); derivation function over `test_sessions` \+ `score_runs` \+ `exam_failure_ledger`; full / partial / failed / pending / not-completed payload shapes; student-safe and guardian-safe surfaces (guardian as strict subset projection); review unlock predicate (`scored` or `partial_scored` only); review-eligibility tied to per-section `submitted` state per 04A V2.2 invariant \#16; anti-leak rules transitioning from 04A's pre-submit posture to 04C's post-unlock review surface; modeled-score disclosure contract with `score_disclosure_versions` table owned by 04C; forbidden phrases list; admin surface with constrained extension; full API surface (8 endpoints) \+ standard precondition chain; existence-vs-access anti-enumeration discipline. | Parent V3.0 §3 subdoc map \+ Karl's scope outline (2026-05-12) \+ 04A V2.2 \+ 04B V4.3 seam |
| V1.0 lock-cycle cleanup | 2026-05-12 | Karl \+ ChatGPT (SWE review) | Post-review cleanup applied within the V1.0 lock cycle (no version bump). **RB-04C-V1-01 (BLOCKER)** `score_disclosure_versions` schema pivoted to `scoring_model_version` as PRIMARY KEY (was `disclosure_version` PK with UNIQUE on `scoring_model_version`, which contradicted the spec text allowing `disclosure_version` reuse across multiple scoring versions); index on `disclosure_version` added for content-management queries. **RB-04C-V1-02 (HIGH)** Invariant \#8 wording tightened: "no canonical state-changing events" rather than "no fan-out"; 04D audit emission explicitly characterized as non-canonical observability artifacts, removing the apparent contradiction with §16.5 step 8 and §20.3. **RB-04C-V1-03 (HIGH) \+ Karl alignment Q3** Access classification split per Karl's V1.0 lock-cycle decision: `never_existed` (no session, ownership mismatch, no current guardian link) returns `403 forbidden` with no body (anti-enumeration); `revoked` (entitlement lapsed, content takedown — current relationship exists) returns `200` with a new `unavailable` payload (§11.5b) carrying `unavailable_reason` and optional `resume_action`. Removed `session_not_found` 404 code (replaced by unified 403 for never-existed). §11.2 payload-by-state matrix updated; §16.6 rewritten; §11.3 serializer updated to handle `unavailable` as a real payload while `never_existed` short-circuits; §12.1 / §12.1b endpoints split classification per family; §17 failure modes updated; §19 acceptance \#13 \+ \#14 rewritten. **Alignment Q1**: `score_disclosure_versions` ownership stays at 04C (V1.0 stance preserved). **Alignment Q2**: `voided` enum value stays MVP-reserved (V1.0 stance preserved). **Non-blocking \#1**: `score_run_id` always-present clarification added to §9.1 partial payload. **Non-blocking \#2**: `estimated_ready_at` wording tightened — explicit non-guarantee in §11.5 field semantics. **Non-blocking \#3**: admin review anti-leak preserved as-written. | ChatGPT SWE review verdict "PASS with small required cleanup" \+ Karl's three V1.0 alignment answers |
| V1.0 lock-cycle cleanup (round 2\) | 2026-05-12 | Karl \+ ChatGPT (SWE review) | Second-pass cleanup applied within the same lock cycle (no version bump). **§14.1 unavailable row consistency fix**: anti-leak matrix row for `unavailable` was stale (still said "request is 403; no payload returned"); updated to \`NEVER | NEVER |

---

**End of Doc 04C V1.0.**

The seam holds. 04A writes runtime state and outbox events; 04B consumes outbox events and writes `score_runs`; 04C reads `score_runs` (and `exam_failure_ledger` for failed cases) and projects the canonical report surface; Doc 05 reads canonical answer state directly without going through 04C. No upstream writes from 04C; no cross-doc state cache; no anti-leak escape hatch.

