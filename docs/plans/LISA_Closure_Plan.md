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
| **W0-1** | Floor-setting Cloud Logging writes student crisis disclosures verbatim | `gcloud logging read '…sanitize_operations' --freshness=1h` returns **zero** entries after the change | Karl |
| **W0-2** | Agent Platform logging writes every prompt and response verbatim | Same shape: no new entries after the change, confirmed after one live turn | Karl |

Both are toggles. Neither loses a control — floor settings are inspect-only and block nothing.

---

## Wave 1 — Prove what is actually running.

| ID | Item | Proof | Owner |
|---|---|---|---|
| **W1-1** | Is `gemini-3.5-flash` serving? | One ordinary tutoring turn; `tutor_turn_metrics.model_name` = `gemini-3.5-flash`. Record the latency | Karl |
| **W1-2** | `terraform apply` | `gcloud scheduler jobs list` shows the SLA sweep; `gcloud tasks queues describe lisa-compaction` exists | Karl |
| **W1-3** | Vercel environment | `CRISIS_SLA_SWEEP_OIDC_AUDIENCE` set; `VERTEX_LOCATION`, `VERTEX_PROJECT_ID`, `GCP_PROJECT_ID` removed; redeployed | Karl |

**Nothing in Wave 2 starts until Wave 1 is closed.** Every failure this month began with not knowing what was deployed.

---

## Wave 2 — Prove what is merged but unverified.

| ID | Item | Proof | Owner |
|---|---|---|---|
| **W2-1** | Retry after a failed turn | Force a turn failure, press Try again: exactly one student message row, successful second attempt | CC + Karl |
| **W2-2** | SLA sweep runs | `gcloud scheduler jobs describe` shows `status.code: 0` and a `lastAttemptTime` | Karl |
| **W2-3** | Compaction runs | End a session; a task appears in `lisa-compaction`; a compaction row is written | Karl |
| **W2-4** | Eight UI states | Screenshot each against the mockup. Needs a preview past Vercel SSO and an entitled test student | Karl provides access, CC walks |
| **W2-5** | Smoke test passes | `scripts/probe/crisis-smoke.ts` — all seven steps green | CC |

---

## Wave 3 — Close what is broken.

| ID | Item | Proof | Owner |
|---|---|---|---|
| **W3-1** | Model Armor protects nothing | A deliberately unsafe output is **blocked** by your template, with the filter named in the log. Standalone Sanitize from the BFF, real enforcement, SDP on output, fail-open with ERROR | CC |
| **W3-2** | LISA invents and grades questions | In general mode, a request for practice produces **no** invented item and **no** model-computed answer. Golden-set case 36 | CC |
| **W3-3** | All students get US crisis resources | A student with a non-US country sees that country's resources. Depends on Stripe country collection | CC + Karl |

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
