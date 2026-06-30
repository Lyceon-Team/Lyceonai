---
name: practice-engine
description: Practice session lifecycle, item serving, idempotent answer submission, and resume safety. Use whenever code starts/serves/resumes a practice session, submits a practice answer, or implements the practice endpoints. Covers the locked endpoint contracts, multi-select filtering, config-driven constants, quota mechanics, and the no-duplicate/no-leak invariants.
---

# Practice Engine (Coding Standards §9 · canonical: docs/Spec)

These endpoint behaviors are **locked**. Do not change their shape or semantics.

| Endpoint                                             | Behavior                                                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `POST /api/practice/sessions`                        | Start session; records `client_instance_id`; multi-select filters (sections, domains, skills, difficulties) |
| `GET /api/practice/sessions/{session_id}/next`       | Serve next item; **no answer or explanation**                                                               |
| `POST /api/practice/answer`                          | Idempotent via `client_attempt_id`; returns correctness + explanation **post-submit**                       |
| `GET /api/practice/sessions/{session_id}/state`      | Resume-safe; **no duplicate items**                                                                         |
| `GET /api/practice/sessions/open`                    | List active sessions with progress                                                                          |
| `POST /api/practice/sessions/{session_id}/terminate` | Close/abandon a session                                                                                     |

## Selection (CEO model — launch)

- **ORDER BY random()** via Supabase RPC (`select_practice_pool_random`). No hand-rolled Fisher-Yates for selection.
- No mastery-aware ranking at launch (§15 adaptive selection is post-launch; SCL-P-01/02/03).
- All N items prepopulated into `practice_session_items` at session creation.
- Fisher-Yates is retained ONLY for per-serve option shuffling (`buildServedOptions`).

## Filtering

Multi-select faceted: `sections[]`, `domains[]`, `skills[]`, `difficulties[]`. Multiple values per facet, none = all. Translated to `WHERE col = ANY(...)` in the pool query.

## Session sizing

Count OR time, default from `practice_runtime_config.default_session_count_web` (10). Time mode derives count via `target_seconds_per_question` config constant.

## Quota mechanics

- **Free tier:** 40 questions/day pooled across sessions. Reset 00:00 per `quota_reset_timezone` config. Enforced at serve time via `check_and_reserve_practice_quota` RPC. Clamped at session creation: `target_count = min(requested, remaining_daily)`.
- **Paid tier:** 60 questions/session max (from `max_session_count_premium` config). No daily cap.

## Session limits

- Max concurrent active sessions: from `max_concurrent_sessions` config (5).
- User can close/abandon any session from practice home or in-session.

## Config doctrine (INV-02B-15)

ALL runtime constants read from `practice_runtime_config` table. No hardcoded literals for session limits, quotas, rate limits, or defaults. Config reader caches per-request.

## Lifecycle

Single source of truth: `practice_sessions.status` column. No dual `metadata.lifecycle_state`.

## Invariants that must not break

- **No answer leakage pre-submit.** `/next` returns `correct_answer: null, explanation: null` (see `anti-leak`).
- **No duplicate items on refresh or resume.** Resuming or re-fetching state must not re-serve or re-create items/sessions.

## Idempotency

`POST /api/practice/answer` dedupes on `client_attempt_id` (UNIQUE constraint): a replayed submit returns the same result and causes exactly one state change. Server is the source of truth for session state and timing — never trust client-reported elapsed time. (§4.2, §4.3)

## Self-check before done

- [ ] `/next` payload has null answer + explanation.
- [ ] Replayed `answer` with same key -> one effect, identical response.
- [ ] Resume/refresh creates no duplicate session or item.
- [ ] All constants read from `practice_runtime_config`, not hardcoded.
- [ ] Selection uses ORDER BY random() via DB RPC, not Fisher-Yates.
- [ ] Quota enforced: free 40/day, paid 60/session.
- [ ] Max 5 active sessions enforced.

## Proving mechanism

Anti-leak route test on `/next`; replay test on `/answer`; resume test that refreshes mid-session and asserts identical item set. Config-read test that asserts no hardcoded constants. (§14.)
