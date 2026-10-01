# Crisis Review Queue & SLA: End-to-End Verification

**Status: INVESTIGATION COMPLETE — no code changed.**
**Date: 2026-09-17**
**Spec coverage: Doc 03_V3 §21, Doc 03C_V3 §8, SCL-025, CR-03C-V3-01 §3.4**

---

## §1 — End-to-End Trace: Crisis Detection → Human Review

The full chain, with file:line references:

```
Student sends message → POST /api/tutor/conversations/:id/messages
    │
    ▼
server/routes/tutor-runtime.ts:835-846
    runCrisisClassifier(sanitized)              ← INV-03-16: every turn, no exceptions
    │
    ├── Layer 1: checkCrisisSignatures()        ← server/services/tutor-crisis.ts:101-161
    │     Queries tutor_injection_signatures WHERE signature_type = 'crisis'
    │     Fails CLOSED if table unreadable (returns triggered: true)
    │
    └── Layer 2: classifyCrisis()               ← server/services/tutor-crisis.ts:175-239
          Vertex AI model inference (crisis_classifier_model_alias)
          Retry-once on failure; on second failure → isCrisis: false, confidence: 0
    │
    ▼  (run in parallel via Promise.all — tutor-crisis.ts:355)
Combined logic                                  ← server/services/tutor-crisis.ts:341-443
    Either layer positive → crisis = true
    Both negative + L2 failed + L1 has zero sigs → crisis = true (classifier_degraded_no_floor)
    Both negative + L2 failed + L1 has sigs → crisis = false, forceReview = true
    │
    ├── crisis = true → tutor-runtime.ts:929-1051
    │     │
    │     ▼
    │   flagConversationForReview()             ← server/services/tutor-crisis.ts:485-614
    │     Step 1 (BLOCKING): UPDATE tutor_conversations SET crisis_flagged = true
    │     Step 2 (BLOCKING): createCrisisReviewCase() → crisis-review-queue.ts:137-295
    │       INSERT crisis_review_cases (sla_deadline = now + 48h, status = 'open')
    │     Step 3 (fire-and-forget): notifyCrisisEvent() → crisis-notification.ts:169-257
    │       Cloud Tasks → Slack incoming webhook (LYCEON_CRISIS_ALERTS)
    │     │
    │     ▼
    │   Look up profiles.country_code → getCrisisResponse() → tutor-crisis.ts:454-457
    │   Persist crisis-safe response to tutor_messages
    │   Serialize through output serializer (isServerAuthored = true)
    │   Return to student with crisis resources
    │
    ├── crisis = false, forceReview = true → tutor-runtime.ts:1056-1063
    │     flagConversationForReview("classifier_degraded")
    │     Turn proceeds to normal generation
    │
    └── Infrastructure failure (catch at :847-872)
          Synthetic crisis = true, source = "infrastructure_failure"
          Fails closed → same crisis path as above
```

**Human review surface:**

```
Admin → /api/admin/crisis-review/*              ← server/routes/admin-crisis-review.ts
    Auth: requireSupabaseAuth + requireSupabaseAdmin (lines 63-65)
    │
    ├── GET  /cases                → listCrisisReviewCases()    (paginated, filterable)
    ├── GET  /cases/:id            → getCrisisReviewCaseById()  (+ audit trail)
    ├── POST /cases/:id/claim      → claimCaseForReview()       (open → in_review)
    ├── POST /cases/:id/disposition → updateCaseDisposition()   (set true_positive/false_positive, resolve)
    └── GET  /sla-breaches         → getBreachedCases()         (open cases past deadline)
```

**SLA sweep:**

```
Cloud Scheduler (hourly) → GET /api/internal/crisis-sla-sweep
    ← server/routes/internal-cron-routes.ts:138-182
    cronAuthorized(req) gate → getBreachedCases()
    Logs HIGH-severity structured error for Cloud Monitoring alert policies
```

---

## §2 — Specific Checks

### §2.1 Case creation race / duplicate handling

**WIRED.** Two layers of duplicate protection:

1. **Database:** `idx_crisis_review_cases_conversation_active` — UNIQUE partial index on `(conversation_id) WHERE status IN ('open', 'in_review')`. Only one active case per conversation at the DB level.

2. **Application:** `flagConversationForReview` (tutor-crisis.ts:537-593) catches PG error code `23505`. On unique violation, queries the existing case and returns its ID. Treated as success-equivalent — the safety obligation is met because a case already exists.

3. **Schema-drift retry:** `createCrisisReviewCase` (crisis-review-queue.ts:159-220) catches PG error code `23514` (CHECK violation) for newer source values not yet in production. Retries with a coarser fallback source.

4. **Blocking guarantee:** All three error paths either succeed (existing case found) or throw — the student never gets an untracked crisis turn.

### §2.2 Notification

**PARTIALLY WIRED.**

- Cloud Tasks queue `lisa-crisis-notification` is defined in Terraform (`infra/terraform/cloud-tasks.tf:14`).
- `notifyCrisisEvent()` at crisis-notification.ts:169-257 enqueues a task with a Slack-compatible payload.
- Payload is **metadata only** per SCL-025(c): case ID, conversation ID, source, SLA deadline, admin review link. No conversation content, no student name.
- Requires `LYCEON_CRISIS_ALERTS` env var (Slack incoming webhook URL). If not set, notification is **silently skipped** with a warning log.
- Fire-and-forget: notification failure does not block the turn. The durable safety record (`crisis_review_cases` row) is the blocking gate.

**Gap:** If `LYCEON_CRISIS_ALERTS` is not configured in the deployment environment, no ops notification fires. There is no startup guard that checks for this env var — unlike the crisis classifier model alias, which is guarded at startup (tests/ci/startup-guards.contract.test.ts:75). The case is still created; only the Slack alert is lost.

### §2.3 Dashboard

**PARTIALLY WIRED.**

- **Backend API:** Complete. Five endpoints at `/api/admin/crisis-review/*` covering list, detail, claim, disposition, and SLA breaches. Auth gated by `requireSupabaseAdmin`. Every read produces a durable audit log entry per SCL-025.
- **Frontend page:** **Not built.** No admin crisis review page exists in `client/src/pages/`. The Slack notification links to `/admin/crisis-review/{caseId}` — a URL that requires a frontend page that does not exist. `client/src/pages/chat.tsx:21` notes "crisis presentation deferred, no special styling."
- **Practical impact:** At V1 the reviewer can use the API directly (curl / API client), but there is no in-product review surface. The Slack link will 404.

### §2.4 SLA measurement

**PARTIALLY WIRED.**

- `sla_deadline` is computed at case creation: `new Date(Date.now() + SLA_HOURS * 60 * 60 * 1000)` where `SLA_HOURS = 48` (crisis-review-queue.ts:36, :152-154).
- `getBreachedCases()` queries open cases past `sla_deadline` (crisis-review-queue.ts:466-520).
- Index `idx_crisis_review_cases_sla_breach` on `(sla_deadline) WHERE status = 'open'` supports efficient sweeps.
- Cron endpoint exists at `GET /api/internal/crisis-sla-sweep` (internal-cron-routes.ts:138-182). Calls `getBreachedCases()`, logs HIGH-severity structured error for Cloud Monitoring.
- Code comments specify: Cloud Scheduler job `crisis-sla-sweep` runs every hour (`0 * * * *`) with `CRON_SECRET` auth.

**Gap:** No Cloud Scheduler Terraform definition exists for `crisis-sla-sweep`. The endpoint exists; the scheduler job to call it has not been provisioned. This is documented in the code as "IAM requirements (report only — Karl provisions)" — same pattern as other cron jobs. Until Karl provisions the Cloud Scheduler job, SLA breaches produce no alert.

### §2.5 Category discriminator

**NOT WIRED (by design at V1).**

The `source` column on `crisis_review_cases` tracks the **detection method**, not the **crisis type**:

| source value | Meaning |
|---|---|
| `signature` | Layer 1 deterministic match only |
| `model` | Layer 2 model classification only |
| `both` | Both layers triggered |
| `classifier_degraded` | Layer 2 failed, Layer 1 had sigs, no match — force review |
| `classifier_degraded_no_floor` | Layer 2 failed, Layer 1 had zero sigs — fail closed |
| `infrastructure_failure` | Entire classifier pipeline threw |

There is no **crisis type** discriminator (self-harm vs. family violence vs. emotional breakdown). The spec (Doc 03 §21.1) lists five detection thresholds but the current classifier treats them as a single binary outcome: crisis / not-crisis.

Doc 03 §21.5 explicitly notes V1 has "severity triage beyond binary crisis/not-crisis" listed under "Not assumed at V1."

This is consistent with the spec. No gap — it's a documented V2 target.

---

## §3 — Guardian Visibility of Crisis Data (HIGHEST PRIORITY)

**FINDING: No crisis or safety event is visible to guardians through any implemented code path.**

Verified at every layer:

| Layer | Evidence |
|---|---|
| **Spec invariant** | INV-03-05 (Doc 03:2150): "Zero guardian LISA access... never from LISA tables." Doc 03D §11.5: crisis flags are "never visible" to guardians. SCL-033 in SPEC_CHANGES_LOG:1861 explicitly forbids crisis flags/status to guardians. |
| **Database RLS** | `crisis_review_cases` and `crisis_review_audit_log` (migration 20260813, lines 241-242): "NO student or guardian policies — these tables are invisible to non-admin roles (section 21.4 student privacy, SCL-025)." Zero `authenticated`-role policies. |
| **API routing** | Admin crisis routes at `/api/admin/crisis-review/*` require `requireSupabaseAdmin`. Guardian routes (`server/routes/guardian-routes.ts`) have zero references to crisis tables. Guardian dashboard queries only KPI, mastery, and billing data. |
| **Notification system** | `notification_events.event_type` CHECK constraint allows only `guardian_linked` and `guardian_unlinked`. No crisis event type exists. Crisis alerts go to Slack via Cloud Tasks, not through the notification system. |
| **Frontend** | `client/src/pages/guardian-dashboard.tsx` has zero references to crisis/safety data. |
| **Anti-leak tests** | `tests/ci/guardian.anti-leak.ci.test.ts` gates RULE-4 forbidden columns from every guardian surface. |

**One acknowledged tension (W-00-01):** The Privacy Policy (line 366) reserves the right to surface safety-triggered conversation excerpts to guardians, but qualifies "limited to what is reasonably necessary." No code implements this disclosure. W-00-01 is tracked as an open reconciliation item between INV-03-05 and the Privacy Policy at Doc 00 V6:414. This is a legal reservation, not an implemented feature.

**Guardian contact for severe safety risks follows a human process (Doc 03 §21.4), not an automated code path.** "Automated guardian alert workflows" are listed under "Not assumed at V1" (Doc 03:1625).

**Conclusion: No live defect. No guardian path to crisis data exists.**

---

## §4 — Data Handling

### §4.1 Message text storage

The student's crisis disclosure **is stored** in Supabase. At `tutor-runtime.ts:874-894`, the student message is persisted to `tutor_messages` BEFORE the crisis path branches at line 929. The `message` column contains the student's actual text (sanitized input).

The crisis-safe response ("Call 988" etc.) is also stored as a tutor-role row in `tutor_messages` at `tutor-runtime.ts:947-964`.

**What is NOT stored with the case:**
- `crisis_review_cases` contains only metadata: `conversation_id`, `student_id`, `source`, `signature_id`, `model_confidence`, `sla_deadline`. No message text.
- Slack notification payload: metadata only per SCL-025(c). Case ID, conversation ID, source, SLA deadline, admin review link. "No conversation content, no student name, no message text" (crisis-notification.ts:16).
- `tutor_turn_metrics`: operational telemetry only. Token counts, durations, flags. No message text.
- Logger calls: event codes, conversation IDs, sources. Never message text. `tutor-policy-logger.ts:21`: "No student content (messages, answers) is ever written — only metadata and counts."

**Reviewer access to content:** The reviewer looks up the conversation via `conversation_id` on the case. The student's message text lives in `tutor_messages` in Supabase, accessible to the admin through the audited review surface.

### §4.2 RLS

Both crisis tables have RLS enabled. Access model:

| Role | `crisis_review_cases` | `crisis_review_audit_log` |
|---|---|---|
| `crisis_review_writer` | INSERT only | INSERT only |
| `crisis_review_admin` | SELECT, UPDATE | SELECT, INSERT |
| `service_role` | ALL | ALL |
| `authenticated` (student/guardian) | **Zero access** | **Zero access** |
| `anon` | **Zero access** | **Zero access** |

`crisis_review_audit_log` has no UPDATE or DELETE policies — it is append-only by design.

The admin review surface (`admin-crisis-review.ts`) uses `requireSupabaseAdmin` middleware, which operates through `supabaseServer` (service_role). At V2 scale (5,000+ users), the admin role "may be too broad for standing read access to minors' crisis conversations" — tracked as open, not resolved (admin-crisis-review.ts:21-23).

### §4.3 Retention

**WIRED.** Retention sweep for crisis data: `server/services/retention-sweep.ts:440-611` (`sweep180d`).

- **Policy:** Only **resolved** cases older than 180 days from `created_at` are swept. Open/in-review cases are retained indefinitely regardless of age.
- **Archive-before-delete:** Rows are first archived to BigQuery (`retention__crisis_review_cases` table) via the `ArchiveClient`. Archive failure blocks delete (safety invariant, :434-435).
- **BigQuery schema:** Referenced in `infra/terraform/bigquery.tf:11` and `scripts/retention/generate-bq-archive-schemas.mjs:46`.
- **Account deletion:** `student_id` FK uses `ON DELETE RESTRICT` (migration 20260813:63). Open crisis cases block account deletion — documented as deliberate: "an open crisis case for a student who wants to delete their account is a counsel question, not an automatic cascade."
- **Injection log:** `tutor_injection_log` rows older than 180 days are swept in the same tier.

### §4.4 Cloud Logging / Agent Platform logging

Crisis events produce structured log entries via the logger (never message text):
- `TUTOR_RUNTIME` / `crisis_classifier_infrastructure_error` — classifier pipeline failure
- `CRISIS_NOTIFICATION` / `enqueued` | `enqueue_failed` | `enqueue_error` — notification lifecycle
- `CRISIS_SLA` / `sla_breach_detected` | `sla_sweep_clean` — SLA sweep outcomes
- `ADMIN_CRISIS_REVIEW` / `*_error` — admin surface errors

Per-turn telemetry in `tutor_turn_metrics`: `crisis_triggered` (boolean), `crisis_classifier_outcome` (text matching source values). No message text.

---

## §5 — Crisis Response Template and Resources

### Template text

Eight country codes covered in `CRISIS_RESOURCES` (tutor-crisis.ts:75-84):

| Code | Organization | Number |
|---|---|---|
| US | 988 Suicide & Crisis Lifeline | 988 |
| CA | Talk Suicide Canada | 1-833-456-4566 / text 45645 |
| UK | Samaritans | 116 123 |
| GB | Samaritans | 116 123 |
| IE | Samaritans Ireland | 116 123 |
| AU | Lifeline | 13 11 14 |
| NZ | Lifeline Aotearoa | 0800 543 354 |
| SG | Samaritans of Singapore | 1-767 |

`DEFAULT_CRISIS_RESPONSE` (tutor-crisis.ts:86-87) is **byte-identical** to the US entry. Every unknown country falls to the US 988 number.

### Country routing

Country is looked up from `profiles.country_code` (tutor-runtime.ts:938-944) with `?? "US"` fallback. `profiles.country_code` is null on all production rows (owner-verified 2026-08-31). Every student everywhere receives the US 988 number.

### Owner ruling

**CLOSED — Owner ruling 2026-08-31:** "crisis is US-scoped. No further investigation, no owner needed, no launch gate. Do not reopen." (`docs/plans/FINDING_crisis_resources_default_to_US.md`)

### ISO note

Both `UK` and `GB` are listed with identical text — someone hit the ISO 3166 encoding ambiguity and worked around it by listing both.

---

## §6 — Deliverable Table

| Step | Spec Reference | Status | Evidence |
|---|---|---|---|
| **Detection: every turn** | Doc 03 §21.1, INV-03-16 | **WIRED** | `runCrisisClassifier(sanitized)` at tutor-runtime.ts:846, runs before orchestration. Infrastructure failure fails closed (:847-872). |
| **Two-layer classifier** | Doc 03C_V3 §8, CR-03C-V3-01 §3.4 | **WIRED** | Layer 1 (sigs) + Layer 2 (model) run in parallel via `Promise.all` at tutor-crisis.ts:355. B1.5 logic at :380-403. |
| **Crisis-safe response** | Doc 03 §21.2 step 2, §4.6 | **WIRED** | LLM generation bypassed entirely. Server-authored crisis resource returned. Serialized through output serializer with `isServerAuthored=true` (:998-1010). |
| **Flag conversation** | Doc 03 §21.2 step 4 | **WIRED** | `UPDATE tutor_conversations SET crisis_flagged = true` at tutor-crisis.ts:491-513. BLOCKING — throws on failure. |
| **Create review case** | Doc 03 §21.3 | **WIRED** | `createCrisisReviewCase()` at crisis-review-queue.ts:137-295. 48h SLA deadline. BLOCKING write. Duplicate handling via unique index + 23505 catch. |
| **Ops notification** | Doc 03 §21.2 step 5 | **PARTIALLY WIRED** | Cloud Tasks → Slack webhook. Metadata-only payload. Fire-and-forget. **Gap: `LYCEON_CRISIS_ALERTS` env var required but no startup guard. Silent skip if absent.** |
| **Admin review API** | Doc 03 §21.3 | **WIRED** | Five endpoints at `/api/admin/crisis-review/*`. `requireSupabaseAdmin` auth. List, detail, claim, disposition, SLA breaches. |
| **Admin review frontend** | Doc 03 §21.3 | **NOT WIRED** | No frontend page exists. Slack notification links to `/admin/crisis-review/{caseId}` which will 404. "Crisis presentation deferred" comment at chat.tsx:21. |
| **Audit logging** | SCL-025 | **WIRED** | Every read of a case writes a durable audit log entry. `writeAuditLogEntry()` at crisis-review-queue.ts:340-418. BLOCKING per SCL-025. Append-only table (no UPDATE/DELETE policies). |
| **SLA measurement** | Doc 03 §21.3 | **PARTIALLY WIRED** | `sla_deadline` computed at case creation. `getBreachedCases()` implemented. Cron endpoint exists. Index supports efficient sweeps. **Gap: Cloud Scheduler job `crisis-sla-sweep` not provisioned in Terraform.** |
| **SLA breach alerting** | Doc 03 §21.3 | **PARTIALLY WIRED** | Cron endpoint logs HIGH-severity structured error. Cloud Monitoring would pick it up. **Requires Cloud Scheduler job (see above) and Cloud Monitoring alert policy.** |
| **Category discriminator** | Doc 03 §21.1 | **NOT WIRED (by V1 design)** | `source` tracks detection method, not crisis type. Spec says "severity triage beyond binary crisis/not-crisis" is V2+ target (Doc 03:1625). |
| **Guardian isolation** | Doc 03 §21.4, INV-03-05, SCL-033 | **WIRED** | Zero guardian access at every layer: RLS, API, notifications, frontend. No live defect. |
| **Retention** | Doc 07E | **WIRED** | 180-day sweep for resolved cases. Archive-before-delete to BigQuery. Open cases retained indefinitely. Account deletion blocked by ON DELETE RESTRICT. |
| **Test coverage** | — | **PARTIALLY WIRED** | 7 test files with crisis coverage: fail-closed contract, credential-absent, ephemeral-pg proof (DDL + RLS), output serializer, retention sweep. **Gap: no test for `getCrisisResponse()` or `DEFAULT_CRISIS_RESPONSE` content (FINDING doc notes this).** |

---

## §7 — Is the Queue Substantially Unbuilt?

**No. The queue is substantially built.** The core safety chain — detection, blocking flag write, durable case creation, duplicate handling, admin API, audit logging, retention, and guardian isolation — is complete and tested.

Three gaps exist, all operational rather than architectural:

1. **Admin frontend page does not exist.** The API is complete but the reviewer has no in-product UI. At V1 (founder + backup reviewer), API-level access is functional but the Slack notification links will 404. This is a product gap, not a safety gap — the case is created and the API works.

2. **Cloud Scheduler job for SLA sweep not provisioned.** The endpoint exists; the scheduler to call it does not. Until provisioned, SLA breaches produce no alert. Karl provisions infrastructure — this is documented in code as an IAM requirement.

3. **`LYCEON_CRISIS_ALERTS` env var has no startup guard.** If absent, crisis notifications are silently skipped. The crisis case is still created (the blocking safety gate), but ops gets no Slack alert. This is a defense-in-depth gap, not a safety gap — the durable record exists regardless.

None of these three compromise the safety invariant (every crisis turn is blocked until a review case exists). All three are operational wiring that Karl provisions.
