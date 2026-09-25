# LISA — Closure Plan

**Lives at:** `docs/lisa-closure-plan.md`, beside `docs/lisa-flow-map.md`.
**Purpose:** the single record of what is closed, what is open, and the exact proof that closes each item.

---

## The rules

**1. An item closes only on a named proof observed in production.** Not a merged PR. Not green CI. Not a passing test. A log line, a database row, a Slack message, a screenshot.

**2. The proof is written before the work starts.** If nobody can say what would prove it, the item is not ready.

**3. Closing an item means updating this file in the same PR**, with the proof output pasted in and the date. The file is the record.

**4. Nothing is "mostly done."** Status is `OPEN`, `IN PROGRESS`, or `CLOSED`. There is no partial.

**5. A new finding becomes a row here — it does not get chased.** That rule is what ends the whack-a-mole. Discovery is fine; unplanned reaction is not.

**6. Every closed item gets a regression guard** — a smoke-test step, a CI check, or a scheduled probe. Closed once, stays closed.

---

## Already closed — with proof

| ID | Item | Proof | Date |
|---|---|---|---|
| C-01 | Crisis Layer 1 detection | `crisis_signature_matched`, non-null `signatureId`, `source: "both"` | 09-23 |
| C-02 | Crisis case creation | Rows in `crisis_review_cases` with SLA deadlines | 09-23 |
| C-03 | **Crisis alert delivery** | Two alerts in `#lyceon-crisis`, 19:02 and 20:15 | 09-23 |
| C-04 | **Per-message escalation** | Second crisis message on an unclaimed case produced a second alert | 09-23 |
| C-05 | Crisis pause and resume | Pause written; `/resume` 200; UI clears | 09-24 |
| C-06 | `SECURITY DEFINER` lockdown | Zero PUBLIC grants across 82 functions | 09-23 |
| C-07 | Guardian consent hole | ACL verified before and after | 09-23 |
| C-08 | Worker configuration | Revision `00030-klv`: `global`, both aliases `gemini-3.5-flash` | 09-23 |
| C-09 | Terraform creates resources | Three retention jobs exist | 09-23 |
| C-10 | Schema alignment | 84 of 86 post-ledger migrations applied | 09-23 |
| W0-1 | Floor-setting Cloud Logging wrote student crisis disclosures verbatim | Agent Platform logging disabled in console; `sanitize_operations` empty across 2h spanning a live crisis turn at 07:34:19Z | 09-24 |
| W0-2 | Agent Platform logging wrote every prompt and response verbatim | Same toggle — Agent Platform *is* the Vertex AI floor setting | 09-24 |
| W1-1 | `gemini-3.5-flash` serving | `turn_metrics_logged` 08:46:47Z — `gemini-3.5-flash`, orchestration 3,359ms (prior `gemini-2.5-pro` 10,460ms) | 09-24 |
| W1-2 | SLA sweep job, compaction queue, `actAs` grant | `terraform apply` 3 added / 0 changed / 0 destroyed; `lyceon-crisis-sla-sweep` ENABLED, `lisa-compaction` RUNNING | 09-24 |
| W1-3 | Vercel environment | `CRISIS_SLA_SWEEP_OIDC_AUDIENCE` set; `VERTEX_LOCATION`, `VERTEX_PROJECT_ID`, `GCP_PROJECT_ID` removed; redeployed | 09-24 |
| W2-2 | SLA sweep runs | Forced run 08:01:22Z — `POST /crisis-sla-sweep 200`, 900ms, OIDC accepted, 3 breaches detected | 09-24 |
| W2-2a | Sweep detected but never notified | Forced sweep produced Slack breach alert naming 3 cases with claim status and hours past SLA | 09-24 |
| W2-3 | Compaction runs | 4 sessions ended 08:05:12–08:05:33Z — each enqueued to `lisa-compaction`, delivered, `compact-writeback 200`, correctly skipped below threshold | 09-24 |
| W4-3 | `TutorConfig.loadAll()` never called | `cache_loaded`, 24 keys, Model Armor IDs now read from DB; prior deployment shows `cache_not_loaded` in the same log window | 09-24 |
| W3-2 | LISA invents and grades questions | Production, worker revision `00032-bht` (`lisa-default-v2`): in general mode a request for practice produced LISA's handoff offer — no invented item, no computed answer — with the `start_practice` link, which navigated to `/practice` | 09-25 |

---

## Wave 0 — Stop active harm. Console only, today.

**All rows closed 2026-09-24** — see *Already closed*.

Both are toggles. Neither loses a control — floor settings are inspect-only and block nothing.

---

## Wave 1 — Prove what is actually running.

**All rows closed 2026-09-24** — see *Already closed*.

**Nothing in Wave 2 starts until Wave 1 is closed.** Every failure this month began with not knowing what was deployed.

---

## Wave 2 — Prove what is merged but unverified.

| ID | Item | Proof | Owner |
|---|---|---|---|
| **W2-1** | Retry after a failed turn — **OPEN** (ruling 09-24: verify in production) | Force a turn failure in **production** (method below), press Try again: exactly **one** student `tutor_messages` row for the conversation's turn, and a completed tutor reply on the second attempt. Paste the row-count query output | Karl, CC confirms method |
| **W2-2b** | Three legacy cases breach every hour | OPEN — `78d6a7ae…` and `10e8e78f…` are outage artifacts from `classifier_degraded_no_floor`; `3d06effb…` (09-17) is real. Resolve via the dashboard; **sign in first** (W2-8). Proof: the identification query in *W2-2b detail* returns zero rows and the next sweep logs `sla_sweep_clean` | Karl |
| **W2-6** | New-case Slack alert shows the conversation ID, not the case ID | OPEN — the breach alert prints full case UUIDs correctly; make the new-case alert match. Also: the structured logger truncates IDs, so log lines cannot be traced to database rows | CC |
| **W2-7** | Nothing in the app links to `/admin/crisis-review` | OPEN — an admin needs the URL or a Slack alert to reach it | CC |
| **W2-8** | Return-path allowlist excludes `/admin` | OPEN — a signed-out admin clicking a Slack alert lands on `/dashboard`, not the case. **This breaks the last step of the escalation path** | CC |
| **W2-9** | Admin claim/disposition POSTs skip `doubleCsrfProtection` | OPEN — not exploitable under `SameSite=Lax`; missing second layer, and the mount comment still says "read-only" | CC |
| **W2-10** | Student's message not shown until LISA responds | OPEN — no optimistic insert; thread renders only on query refetch. Same root cause as the original duplicate-send stacking. **Fix in PR (this branch):** the message renders on send, keyed by `client_turn_id`, and reconciles to the persisted row; a failed turn keeps it above FailedTurn; a retry reuses the id, so one bubble. Proof: in production, send a message and see it before the reply; force a failed turn (W2-1 method) and see it stay | CC |
| **W2-4** | Eight UI states — **OPEN** (ruling 09-24: verify in production) | Walk the UI on Karl's signed-in account with Claude in Chrome; eight screenshots, each against the mockup. A state that cannot be reached becomes a new row | Karl + Claude in Chrome |
| **W2-5** | Smoke test — **OPEN** (ruling 09-24: done in the UI, script skipped) | The script's seven steps done in the production UI, each verified from the database and logs: a conversation, a normal turn, a crisis turn, the `crisis_review_cases` row, the `crisis_review_events` row, the Slack message, and a clean end. **Slack delivery is proven only by a human seeing the message in `#lyceon-crisis`** — nothing in the logs proves receipt | Karl |


### Ruling 2026-09-24 — Wave 2 verification runs in production, not a preview

The preview route needed seven setup items to verify three rows. Production is pre-launch with no student traffic, and it is where every proof this morning came from. The access checklist is retired.

### W2-1 detail — forcing a failed turn in production (method confirmed by CC, 09-24)

1. In Vercel **Production**, set `TUTOR_ORCHESTRATOR_WORKER_URL=https://lyceon-w2-1.invalid` and **redeploy**. An env var change takes effect only in a new deployment.
2. Open `/chat`, start a new session, send one ordinary (non-crisis) message. The turn fails and the UI shows **Try again**. **Do not reload the tab**: the retry keeps the same `client_turn_id` only in page memory.
3. Restore the real `TUTOR_ORCHESTRATOR_WORKER_URL` and **redeploy**. Wait for the deployment to be Ready.
4. Press **Try again** in the same tab. The tutor reply arrives.
5. Paste:
   ```sql
   select role, status, count(*) from tutor_messages
   where conversation_id = '<conversation id>' group by role, status order by role;
   -- expected: student | completed | 1   and   tutor | completed | 1
   ```

**Why this takes the retry path and not some other branch.**
- **The worker call never throws.** In `postToWorker` (`server/lib/tutor-orchestrator-client.ts`), every failure returns `ok: false`: a DNS failure (`fetch` throws, logs `worker_unreachable`, `orchestration_failed_recoverable`), a timeout, a 5xx after one retry, another non-2xx, bad JSON, or a schema mismatch.
- **The `https://` URL adds one earlier step.** The client first mints an OIDC identity token for that URL. With the service-account credential, minting for any audience succeeds. If it ever failed, it would return `orchestration_auth_failed`, which is also `ok: false`.
- **Every `ok: false` takes the same route branch.** The student row is set to `failed` and the route answers with the error code plus `retry_after_ms` (`tutor-runtime.ts`, step 14). All three codes are registered in `tutor-error-codes.ts`, so none of them falls through to the catch-all.
- **The UI treats any non-pause error as a failed turn,** keeps `client_turn_id`, and offers Try again.
- **On retry,** step 8 finds the `failed` student row, compare-and-sets it back to `pending`, and orchestrates with **no second insert**.
- **A DNS failure and a 500 do not take different paths here.** Both end in the same failed-turn branch. `.invalid` is reserved and never resolves, so the failure is immediate and not a 30s timeout.

**What else breaks during the window, about 2–4 minutes:**
- **Normal tutor turns** fail and can be retried.
- **Crisis turns are unaffected.** They never call the worker.
- **Do not end a session during the window.** Compaction's writeback calls the worker's `/compact`, and would fail and retry through Cloud Tasks.
- **Nothing else reads the variable.**

**§14.3 in-flight 409.** The UI disables Send while a turn is in flight, so production UI testing cannot reach this path. It stays proven by `tests/ci/tutor-runtime.retry-and-detail.contract.test.ts`.

**Pending past 300s.** A stale `pending` row only arises if the function dies mid-turn, because the 30s worker timeout marks a turn `failed` instead. This query should stay empty:
```sql
select id, created_at from tutor_messages
where role = 'student' and status = 'pending' and created_at < now() - interval '300 seconds';
```

### W2-2b detail — the three standing breaches (not applied; Karl applies)

Identified 2026-09-24 from production. These are the rows, not the hashed log ids (see W2-6).

| Case | Source | Created | SLA deadline | Events | Nature |
|---|---|---|---|---|---|
| `78d6a7ae-34c7-4dc2-b65f-c7e75d539293` | `classifier_degraded_no_floor` | 09-01 10:34Z | 09-03 | 0 | outage artifact |
| `10e8e78f-e8cf-4fec-b9c7-bb3848077cc6` | `classifier_degraded_no_floor` | 09-02 10:08Z | 09-04 | 0 | outage artifact |
| `3d06effb-fe0a-46f5-bcf3-28adccfa64f7` | `both` (Layer 1 + Layer 2) | 09-17 12:56Z | 09-19 | 0 | **real signal, needs a human review** |

**Preferred: the admin dashboard** (`/admin/crisis-review/<case id>`). It writes the disposition, `reviewer_id`, `reviewed_at`, notes, and the `disposition_set` audit row exactly as the product does. That is also that surface's first real use.
- **The two outage artifacts:** set `false_positive`.
- **`3d06effb`:** read the conversation first and choose the disposition that is true.

**Identification query** (read-only):
```sql
select id, status, source, category, created_at, sla_deadline, conversation_id
from crisis_review_cases
where status in ('open', 'in_review') and sla_deadline < now()
order by sla_deadline;
```

**SQL fallback** (only if the dashboard cannot be used). Run it once per case. Set the three values at the top. It mirrors `updateCaseDisposition()` and `writeAuditLogEntry()` in `server/services/crisis-review-queue.ts`, as a single transaction:
```sql
begin;
with params as (
  select '<case id>'::uuid                  as case_id,
         '<Karl profiles.id>'::uuid         as reviewer_id,
         'false_positive'::text             as disposition,  -- or 'true_positive'
         'Resolved 2026-09-24: <reason>'    as notes
), upd as (
  update crisis_review_cases c
     set disposition = p.disposition, status = 'resolved',
         reviewer_id = p.reviewer_id, reviewed_at = now(), review_notes = p.notes
    from params p
   where c.id = p.case_id and c.status in ('open', 'in_review')
  returning c.id, c.conversation_id
)
insert into crisis_review_audit_log (case_id, conversation_id, reviewer_id, action, metadata)
select u.id, u.conversation_id, p.reviewer_id, 'disposition_set',
       jsonb_build_object('disposition', p.disposition, 'previous_status', 'open',
                          'new_status', 'resolved', 'via', 'sql_w2_2b')
  from upd u cross join params p;
-- expect: INSERT 0 1. If 0, the case was already resolved or the id is wrong. Roll back and check.
commit;
```

**Proof:**
- The identification query returns zero rows.
- Each case has a `disposition_set` audit row.
- The next forced sweep logs `sla_sweep_clean`, and once W2-2a is live it posts no breach message.

---

## Wave 3 — Close what is broken.

| ID | Item | Proof | Owner |
|---|---|---|---|
| **W3-1** | Model Armor protects nothing | A deliberately unsafe output is **blocked** by your template, with the filter named in the log. Standalone Sanitize from the BFF, real enforcement, SDP on output, fail-open with ERROR | CC |
| **W3-2** | LISA invents and grades questions | **CLOSED 09-25** — proven in production on worker revision `00032-bht`; see the Closed table. Ruling 2026-09-25: retrieval for discussion only; no grading, no attempt, no mastery write; general mode hands off to practice (PR #890, prompt `lisa-default-v2`, golden CASE-36) | CC |
| **W3-2a** | Golden set has no case for LISA fabricating a question | DONE (branch `…-w3-2-worker-prompt`) — CASE-36 in `docs/eval/lisa/LISA_Golden_Set_v2.md` and the fixtures; deterministic half tested, model half runs in Phase B. The fabricated-memory case previously noted as 36 is now owed as CASE-37 | CC |
| **W3-3** | All students get US crisis resources | A student with a non-US country sees that country's resources. Depends on Stripe country collection | CC + Karl |
| **W3-4** | Model Armor template IDs still ride the orchestrate wire and the worker's Cloud Run env, unused since W3-1 | The deployed worker's `orchestrateRequestSchema` no longer requires `model_armor_*_template_id`, **then** the BFF stops sending them; `MODEL_ARMOR_*` absent from the Cloud Run revision and from Vercel. Two steps, worker first — the running worker 400s every turn if the BFF drops them early | CC + Karl |
| **W3-5** | A crisis the classifier misses, blocked by Model Armor's `dangerous` filter, reaches no human | **Ruled 2026-09-24:** an input block whose matched filters include `dangerous` opens a crisis review case and alerts; the student still sees the neutral block copy, not the crisis template (the filter is broad and not clinical — firing crisis resources on it would undercut the deterministic Layer 1/Layer 2 design). Proof: a `dangerous` input block in production → a new `crisis_review_cases` row with `source = 'model_armor_dangerous'` and a Slack alert, and the reply is the block copy. **Apply migration `20261003000000` before the code deploys** — without it the case insert fails CHECK (logged ERROR `model_armor_crisis_flag_failed`; the student still gets the block copy) | CC |
| **W3-4b** | Mastery never reaches the prompt | OPEN — **verified 2026-09-25:** `hasMastery: true` is `snapshot !== null`, and general mode sends an all-null `scope:"all"` placeholder, so `renderMasteryBlock` returns null and the system instruction carries no mastery. Every production turn has been general mode; both students who used LISA have mastery rows (50 skill, 16 domain). Fix: BFF fills the general-mode snapshot (deploys on merge); student-wide domain bands need a wire field + worker renderer (Cloud Build). Proof: assert on the assembled system instruction, not the envelope | CC |
| **W3-6** | `google-auth-library` is a worker dependency that no worker source imports since W3-1 | Removed from `apps/workers/tutor-orchestrator/package.json` in a cleanup pass; worker builds and deploys. Low priority — ruled not worth its own PR now (2026-09-24) | CC |
| **W3-7** | Practice selector is `ORDER BY random()` with no mastery input | OPEN — contradicts the determinism ruling. Pre-existing, practice-side | CC |
| **W3-8** | `isPreSubmitForSurface("dashboard")` returns post-submit | OPEN — **launch-blocking.** A general-mode conversation attaching a question ID puts `correct_answer` on the wire. Latent today only because `question_content` is null. **Fix in PR (branch `…-w3-8-gates`):** dashboard is pre-submit (no item, no submission record); review reads `review_session_items.status` (was hard-coded post-submit — the review half of the same fix, launch-blocking for W4-1) | CC |
| **W3-9** | SCL-111 marks tutor-in-review deferred | DRAFTED — SCL-150 (PROPOSED, PR #891) amends SCL-111: deferral withdrawn, CR-02B-29 in force, post-submit tutor row added for review; owner action pending | CC |
| **W3-10** | SCL-060 sends `explanation` pre-submit in practice | OPEN — ruling 2026-09-25: reverse. Possession is the control, not instruction (CR-02B-29: cannot leak what it doesn't have). SCL amendment drafted PROPOSED | CC |

### W3-1 detail — what shipped, and the proof still owed

**Shipped (code):** both scan points run in the BFF against the regional Sanitize API
(`https://modelarmor.us-central1.rep.googleapis.com`, a constant — not `VERTEX_LOCATION`),
templates from `TutorConfig`, credential from `server/lib/gcp-credentials.ts`.
Input scan before `orchestrateTurn` — a block skips the model; output scan after it —
the verdict is `armorOutputBlocked` in `serializeTutorOutput`, which substitutes.
Fail open on every scanner failure, with ERROR. Timeout 1500 ms per scan. Clean → INFO
`model_armor_scan_clean`, blocked → WARN `model_armor_scan_blocked` (filters named),
skipped → ERROR `model_armor_scan_skipped` (reason). No text in any log line.
The crisis path returns before either scan. Dead code deleted: the worker's
`sanitizeOutput`, `_buildInputModelArmorConfig`, `armorOutputBlocked: false`,
`getModelArmorConfig` in the BFF.

**Spec status — SCL-142, PROPOSED (ruled 2026-09-24: write it).** `docs/Spec` never
mentions Model Armor. Doc 03 §18.2 Layer 4 and INV-03-12 name the deterministic output
scans in `serializeTutorOutput`, which are unchanged, run on every reply, and still fail
closed. Model Armor sits on top and fails open. SCL-142 asks for Model Armor in §18.2,
an INV-03-12 carve-out for the model-backed layer, and W3-5's case source in §21.3.

**Student copy on a block (both points), approved 2026-09-24:** *"Let's keep this on your
SAT prep. What would you like to work on next?"* — no implied accusation on a false positive.

**Karl, before the proof can pass:** grant `roles/modelarmor.user` to
`lyceon-server-sa@replit-cop.iam.gserviceaccount.com`. Without it every scan is a 403 →
ERROR `model_armor_scan_skipped reason=http_error http_status=403`, and turns proceed
unscanned — the feature inert while appearing wired. Also delete `MODEL_ARMOR_*` from
Vercel; nothing reads them.

**Proof owed after deploy** (not yet run — the read-only credential was not in the
session that built this; environment variables reach new sessions only):

| # | Check | Result |
|---|---|---|
| 1 | Ordinary turn → `model_armor_scan_clean` at `input` and `output`, `latency_ms` recorded | *pending* |
| 2 | Deliberately unsafe input → `model_armor_scan_blocked`, `matched_filters` named | *pending* |
| 3 | Crisis turn → zero `TUTOR_MODEL_ARMOR` lines, crisis response unchanged | *pending* |
| 4 | `turn_metrics_logged.orchestrationDurationMs`, 24 h before vs after (now includes both scans) | *pending* |

**Measure before enforcement is trusted** — the same session, with the credential, sends
ordinary tutoring text through both templates directly and reports matches:
- `pi_and_jailbreak` at `LOW_AND_ABOVE` is on the **output** template too; a tutor reply
  that quotes instructions ("ignore the distractor and…") is the likeliest false positive.
- `SEXUALLY_EXPLICIT` at `LOW_AND_ABOVE` against literature-passage discussion.
- SDP on output is `basic_config`. As CC recalls Google's docs, its fixed infoTypes are
  financial/government IDs and cloud credentials, not `PERSON_NAME`, so a student's name
  echoed back should not match. The docs host is blocked from CC's sandbox and the proto
  does not list them — **confirm with a real call before relying on it.**
Thresholds are Terraform and Karl's ruling; any false positive found is reported, not tuned.

**Latency:** two sequential calls at the measured 0.18–0.42 s each is roughly 0.4–0.9 s on a
3–5 s turn — 8 % to 30 %, straddling the 15 % line. Item 4 settles it. If over, the first
lever is starting the input scan in parallel with context resolution (it needs only the
student's message); output-only scanning is the fallback.

---

## Wave 4 — Not built.

| ID | Item | Proof | Owner |
|---|---|---|---|
| **W4-1** | LISA in practice and review | **PROMOTED TO LAUNCH SCOPE (2026-09-25)** — review is the priority; a core purpose of review is learning from mistakes with LISA. Review first, practice after. Review is a graded re-attempt: pre-submit LISA gets stem/passage/options only (CR-02B-29); post-submit, answer and explanation. One conversation per review item. Proof: a scoped turn from review, anti-leak holding pre-submit, discussion allowed post-submit. **Built (2026-09-25):** server review scope — review tables, ownership, item-anchored question (PR #888); client panel — Ask LISA beside the review question, chip naming it, close, scoped composer, one conversation per item (branch `…-w4-1-review-panel`). Practice keeps `features.tutor: false` until review is proven. Production proof owed | CC |
| **W4-2** | Golden set Phase B | The judge reproduces Karl's verdicts on all ten gold responses, then scores the remaining 25 | CC + Karl |
| **W4-6** | LISA-assisted attempts count toward mastery normally | RULED 09-25 — Karl: leave it. LISA is Socratic and cannot give the answer pre-submit (server-enforced), so an assisted correct answer is still the student arriving at it. Mastery formula and RPC untouched | Karl |
| **W4-7** | No record of whether LISA was used on an attempt | OPEN — add an `assisted` boolean to practice and review attempt rows. Definition: at least one student message on that item's tutor conversation before submit. Data only, nothing reads it | CC |


### W4-3 detail — before/after of every key the runtime reads

Read from production `tutor_context_runtime_config` on 2026-09-24. All 24 rows are `environment = all`, so there are no per-environment duplicates for `loadAll()` to collide on.

| Key | Read at | Served before (default) | Database value = served after | Changes? |
|---|---|---|---|---|
| `recent_message_window` | `tutor-compaction.ts:141`, `tutor-memory.ts:438` | 12 | 12 | no |
| `observation_promotion_threshold` | `tutor-memory.ts:365` | 5 | 5 | no |
| `friction_long_pause_seconds` | `tutor-context.ts:844` | 120 | 120 | no |
| `tutor_request_timeout_seconds` | `tutor-orchestrator-client.ts:181` | 30 | 30 | no |
| `model_armor_input_template_id` | `tutor-context.ts:1235` → worker wire | `null` | `lyceon-lisa-input-v1` | **yes, inert.** The worker ignores it until W3-1 |
| `model_armor_output_template_id` | `tutor-context.ts:1237` → worker wire | `null` | `lyceon-lisa-output-v1` | **yes, inert.** Same |

The other 16 keys in the schema are not read by any code path, and their database values equal their defaults.

`crisis_classifier_model_alias` and `vertex.model.*_class_alias` are not `TutorConfig` keys, so this change does not touch them.

**What changed.**
- `TutorConfig.bootLoad()` runs once per process at module load in `server/index.ts`. On Vercel the app module *is* the boot, because `app.listen` never runs there.
- The load is single-flight and never throws. A failure logs ERROR `boot_load_failed` and the process keeps serving the defaults it served before.
- `/api/tutor` and the internal memory (compaction) routes wait up to 3s for the load to settle, so a cold-start request cannot race it.
- The per-call `cache_not_loaded` warning is removed.
- `cache_loaded` now logs the effective value of every key.

**Closed 09-24** — see *Already closed*.

---

## Launch gate

**Blocking:** W0-1, W0-2, W1-1, W1-2, W1-3, W3-1, W3-2, W3-3, W3-8, W4-1 (review).

**Not blocking:** W2-2, W2-3, W4-1, W4-2, W4-3 — each an explicit, recorded decision to launch without it.

---

## Working method

**One wave at a time.** No item in a later wave starts before the current wave is closed.

**One PR per item** where code is involved. The PR closes exactly one row and updates this file with the proof.

**A new finding is a new row.** Given an ID, a proof, a wave. It is not fixed on discovery unless it is active harm — in which case it goes to Wave 0 and everything else stops.

**Proofs come from production**, not from a test suite. Tests prevent regressions; they do not prove a thing runs.

**When an item closes, its proof becomes a guard** — a smoke-test step, a CI check, or a scheduled probe. That is what makes closure permanent instead of momentary.
