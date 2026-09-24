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

---

## Wave 0 — Stop active harm. Console only, today.

| ID | Item | Proof | Owner |
|---|---|---|---|
| **W0-1** | Floor-setting Cloud Logging writes student crisis disclosures verbatim — **CLOSED 09-24** | Agent Platform floor logging disabled; `sanitize_operations` returned **zero** entries across a 2h window that spanned a live crisis turn | Karl |
| **W0-2** | Agent Platform logging writes every prompt and response verbatim — **CLOSED 09-24** | Same check: zero new entries across the 2h window, including one live turn | Karl |

Both are toggles. Neither loses a control — floor settings are inspect-only and block nothing.

---

## Wave 1 — Prove what is actually running.

| ID | Item | Proof | Owner |
|---|---|---|---|
| **W1-1** | Is `gemini-3.5-flash` serving? — **CLOSED 09-24** | `tutor_turn_metrics` at 07:34:44Z: `model_name = gemini-3.5-flash`, orchestration **4,731 ms**. The prior turn (09-23 06:29Z) was `gemini-2.5-pro` at 10,460 ms | Karl |
| **W1-2** | `terraform apply` — **CLOSED 09-24** | `terraform apply`: 3 added, 0 changed, 0 destroyed. `lyceon-crisis-sla-sweep` ENABLED; `lisa-compaction` RUNNING | Karl |
| **W1-3** | Vercel environment — **CLOSED 09-24** | Env updated as specified and production redeployed | Karl |

**Nothing in Wave 2 starts until Wave 1 is closed.** Every failure this month began with not knowing what was deployed.

---

## Wave 2 — Prove what is merged but unverified.

| ID | Item | Proof | Owner |
|---|---|---|---|
| **W2-1** | Retry after a failed turn — **OPEN, blocked on access** (checklist below) | Force a turn failure on a **preview** (method below), press Try again: exactly **one** student `tutor_messages` row for the `client_turn_id`, and a completed tutor reply on the second attempt. Paste the row-count query output | CC + Karl |
| **W2-2** | SLA sweep runs — **CLOSED 09-24** | Forced sweep 08:01:22Z: `POST /crisis-sla-sweep` **200**, 900 ms, OIDC accepted, 3 breaches detected. That run exposed W2-2a and W2-2b | Karl |
| **W2-2a** | SLA sweep detects but never notifies — **IN PROGRESS** (code: #866, awaiting deploy). Found 09-24 by the W2-2 forced sweep: `sla_breach_detected` at ERROR with 3 case ids, then nothing | A forced `POST /crisis-sla-sweep` produces **one** message in `#lyceon-crisis` naming every breached case. The message shows each case's claimed/unclaimed state and hours past SLA, and links to the admin review. Paste the Slack message and the `CRISIS_NOTIFICATION enqueued` log line with `alert: "sla_breach"` | CC + Karl |
| **W2-2b** | Three legacy cases breach on every sweep — **OPEN, Karl applies** | All three resolved with a disposition and a matching `crisis_review_audit_log` row. Then a forced sweep logs `sla_sweep_clean`. Queries in *W2-2b detail*; the admin dashboard is preferred | Karl |
| **W2-6** | *New 09-24.* Case ids in logs are hashed, so a log line cannot be traced to its row. The sweep logged `e0819662`, `3cc599af`, `6ffc13ff`; the rows are `78d6a7ae…`, `10e8e78f…`, `3d06effb…`, and no table holds the logged values. The logger shortens ids the same way elsewhere (`conversationId: "a33473de"` for `d3e4dba1…`) | An operator can go from a crisis log line to the case row. Either full case ids are logged (they are opaque UUIDs, not PII), or the hash is documented with a lookup. Decide which | CC + Karl |
| **W2-3** | Compaction runs — **CLOSED 09-24** | Four sessions ended 08:05:12–08:05:33Z. Each was enqueued and delivered, `compact-writeback` returned **200**, and each was correctly skipped below the threshold | Karl |
| **W2-4** | Eight UI states — **OPEN, blocked on access** (checklist below) | Eight screenshots, each against the mockup. A state that cannot be reached becomes a new row | Karl provides access, CC walks |
| **W2-5** | Smoke test passes — **OPEN, blocked on access** (checklist below) | `scripts/probe/crisis-smoke.ts` against production: all seven steps green, output pasted. **Step 6 proves only that the Cloud Tasks enqueue was attempted, not that Slack received it.** A human confirms the message in `#lyceon-crisis` by the case id the script prints | CC |


### Access checklist for W2-1, W2-4 and W2-5 — one pass, Karl

Provide these in the environment's settings (never paste secrets into chat):

1. **Preview access past Vercel SSO.** Either a *Protection Bypass for Automation* secret (Vercel → Project → Settings → Deployment Protection), set as `VERCEL_AUTOMATION_BYPASS_SECRET`, or a preview served on a custom domain.
2. **An entitled test student**, 13 or older, with no real data. Set `STUDENT_TEST_EMAIL` and `STUDENT_TEST_PASSWORD`.
3. **Which Supabase project Preview points at.** If it is production (`hncolwkccbbjkfithhlo`), say so: the walkthrough and W2-1 then write test rows to the production database.
4. **Crisis alerts.** Confirm the walkthrough's paused state and the smoke test may post to `#lyceon-crisis`, or point Preview's `LYCEON_CRISIS_ALERTS` at a test channel. The smoke test runs against **production**, and it opens a real case and posts a real alert.
5. **Preview env.** Set `TUTOR_ORCHESTRATOR_WORKER_URL` and `GCP_SERVICE_ACCOUNT_JSON` on the Preview environment.
6. **For W2-5 only**, set `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` for production, and `BFF_BASE_URL=https://lyceon.ai`. The script never prints the key or the student credential.
7. **For W2-1,** allow one Preview-only env change and one redeploy (see the method below).

### W2-1 detail — how to force a failed turn (preview only)

**Recommended: a Preview-scoped worker URL change.** Production reads its own copy of this env var, so production never sees it.

1. Deploy the branch preview. Set **Preview-only** `TUTOR_ORCHESTRATOR_WORKER_URL=https://127.0.0.1.invalid` and redeploy the preview.
2. Open the preview on its **branch alias URL**. Start a session and send one message. `orchestrateTurn` fails, the route returns the failed-turn error, and the student row is marked `failed`. The UI shows **Try again** and keeps the same `client_turn_id` in memory.
3. **Leave the tab open.** Restore the real Preview `TUTOR_ORCHESTRATOR_WORKER_URL` and redeploy. The branch alias now serves the fixed deployment.
4. Press **Try again**. The route finds the `failed` student row, compare-and-sets it back to `pending`, and orchestrates **without a second insert**. The tutor reply arrives.
5. Paste the output of:
   ```sql
   select role, status, count(*) from tutor_messages
   where conversation_id = '<conversation id>' group by role, status order by role;
   -- expected: student|completed|1  and  tutor|completed|1
   ```

**Rejected alternatives:**
- **Bad model alias.** The worker is one Cloud Run service shared by preview and production, so changing an alias breaks production.
- **Lowering `tutor_request_timeout_seconds` in the database.** After W4-3 it is read from the shared database, and a preview pointed at production would slow production too.
- **An injected fault flag.** It adds a fault path to production code.

**The §14.3 paths:**
- **In flight, returns 409 `idempotency_in_progress`.** The UI disables Send while a turn is in flight, so this needs a direct request: the same `client_turn_id` posted twice about 1s apart with the session cookie and CSRF token. On the preview, with the worker restored, the second call returns 409 with `retry_after_ms: 2000`. CC can run this once item 1 of the checklist exists.
- **Failed, resumes.** Covered by steps 1–4 above.
- **Pending past 300s, resumes.** **Not cheaply forceable.** The BFF's 30s worker timeout marks a hung turn `failed`, not `pending`, so a stale `pending` row only arises when the function is killed mid-turn. Its proof is the CI contract test (`tests/ci/tutor-runtime.retry-and-detail.contract.test.ts`). The production check is a query that should stay empty unless it happens:
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
| **W3-2** | LISA invents and grades questions | In general mode, a request for practice produces **no** invented item and **no** model-computed answer. Golden-set case 36 | CC |
| **W3-3** | All students get US crisis resources | A student with a non-US country sees that country's resources. Depends on Stripe country collection | CC + Karl |
| **W3-4** | Model Armor template IDs still ride the orchestrate wire and the worker's Cloud Run env, unused since W3-1 | The deployed worker's `orchestrateRequestSchema` no longer requires `model_armor_*_template_id`, **then** the BFF stops sending them; `MODEL_ARMOR_*` absent from the Cloud Run revision and from Vercel. Two steps, worker first — the running worker 400s every turn if the BFF drops them early | CC + Karl |
| **W3-5** | A Model Armor input block answers a missed crisis with "I can't help with that one" | Decision first: an input block on `rai:dangerous` also flags the conversation for crisis review (or not). Found wiring W3-1; see *W3-1 detail* | Karl |

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

**Spec status — Karl to rule:** `docs/Spec` never mentions Model Armor. Doc 03 §18.2
Layer 4 and INV-03-12 ("failed scans block the response… scans are not optional") name
the deterministic output scans in `serializeTutorOutput`. Those are unchanged, run on
every reply, and still fail closed. Model Armor sits on top as an additional layer, and
fails open by your ruling. The code cites the closure plan, not §18.2. Whether Model Armor
and its fail-open posture should be written into Doc 03 through an SCL entry is your call.
CC has not allocated an SCL number.

**Student copy on a block (both points):** *"I can't help with that one. Let's get back
to your SAT prep — what would you like to work on next?"*

**Karl, before the proof can pass:** grant `roles/modelarmor.user` to the service account
in Vercel's `GCP_SERVICE_ACCOUNT_JSON`. Without it every scan is a 403 → ERROR
`model_armor_scan_skipped reason=http_error http_status=403`, and turns proceed unscanned.

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
| **W4-1** | LISA in practice and review | A scoped turn from each surface, anti-leak holding pre-submit | CC |
| **W4-2** | Golden set Phase B | The judge reproduces Karl's verdicts on all ten gold responses, then scores the remaining 25 | CC + Karl |
| **W4-3** | `TutorConfig.loadAll()` — **IN PROGRESS** (Karl ruled *enable*, 09-24; code in the W4-3 PR, awaiting deploy) | Production logs show `TUTOR_CONFIG cache_loaded` with `effective.model_armor_input_template_id = "lyceon-lisa-input-v1"` (a database value; the default is `null`), and a tutor request with **no** `cache_not_loaded` line. See *W4-3 detail* below | CC |


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

**Proof to paste here after deploy:**
1. The `cache_loaded` line with its `effective` values.
2. One `POST /api/tutor/messages` request log with no `cache_not_loaded` line.

---

## Launch gate

**Blocking:** W0-1, W0-2, W1-1, W1-2, W1-3, W3-1, W3-2, W3-3.

**Not blocking:** W2-2, W2-3, W4-1, W4-2, W4-3 — each an explicit, recorded decision to launch without it.

---

## Working method

**One wave at a time.** No item in a later wave starts before the current wave is closed.

**One PR per item** where code is involved. The PR closes exactly one row and updates this file with the proof.

**A new finding is a new row.** Given an ID, a proof, a wave. It is not fixed on discovery unless it is active harm — in which case it goes to Wave 0 and everything else stops.

**Proofs come from production**, not from a test suite. Tests prevent regressions; they do not prove a thing runs.

**When an item closes, its proof becomes a guard** — a smoke-test step, a CI check, or a scheduled probe. That is what makes closure permanent instead of momentary.
