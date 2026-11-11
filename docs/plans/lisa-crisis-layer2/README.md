# Crisis classifier Layer 2: failure reason and timeout

Owner brief "Crisis classifier: record the failure reason, and look at the timeout" (Karl,
2026-11-08). SCL-276.

## The incident

On 2026-11-05 at 21:38 a student wrote "answer". Layer 2 (the model classifier) returned
`classifier_degraded` after about 6 s, and the turn failed closed into the review queue, which is
correct.

Whether it was a timeout, a 429 or a 5xx can't now be told. The reason was only in Vercel's logs,
which expire after an hour. About 6 s is two attempts at the 3000 ms bound, which is consistent
with two timeouts. It is also consistent with a slow 5xx, so nothing here is claimed as the cause.

## What is recorded now

| Where                                          | Column                       | Values                                                      |
| ---------------------------------------------- | ---------------------------- | ----------------------------------------------------------- |
| `crisis_review_cases` (degraded cases only)    | `degraded_reason`            | `timeout`, `rate_limited`, `upstream_error`, `config_error` |
|                                                | `classifier_attempts`        | 0 (setup failed), 1, 2                                      |
| `tutor_turn_metrics` (every turn Layer 2 runs) | `crisis_classifier_ms`       | wall time across attempts and setup                         |
|                                                | `crisis_classifier_attempts` | 0–2                                                         |
|                                                | `crisis_degraded_reason`     | as above, or NULL when Layer 2 answered                     |

How a failure is classified (`classifyClassifierFailure`, `server/services/tutor-crisis.ts`):

- `timeout`: our bound, or an aborted request.
- `rate_limited`: HTTP 429 or RESOURCE_EXHAUSTED.
- `config_error`: any other 4xx, a NOT_FOUND, a missing model env var or credential. These would
  fail the same way again.
- `upstream_error`: everything else, such as a 5xx, a network failure or output the parser can't
  read.

The failure posture is unchanged. Whatever the reason, a classifier that can't answer means human
review, never "assume safe". The reason is written to the case after the flag commits, as a
separate guarded update that never blocks the turn.

## Queries

`layer2-metrics.sql` (read-only) has four queries:

1. Degraded rate per day. This works on history, because the outcome column predates this change.
   The baseline is 1 degraded turn in 123 over 7 days.
2. Layer 2 latency per day: p50/p95/p99 for first-try successes and for all turns, plus the retry
   count.
3. Query 2b: the timeout recommendation's input, first-try latency over the whole week.
4. Failure reasons per day, on turn rows and on review cases.

## Recommending the timeout

There is no latency history yet: until this change, only the outcome was stored. **3000 ms
(SCL-269) stays until at least seven days of rows exist.** Then run query 2b and apply this rule:

- **Population:** first-try successes (1 attempt, no reason). That is the latency the bound is
  meant to allow.
- **Candidate:** the larger of 1.5 × p99 and p99.9, rounded up to the next 250 ms.
- **Change it** only if the candidate differs from 3000 ms by more than 250 ms.
- **Lowering it** cuts the worst-case turn delay (two attempts) but sends more turns to review.
  Check the `timeout` share in query 3 first.
- **Raising it** cuts timeout-driven reviews but adds up to twice the increase to a degraded
  turn's latency.
- **Either way:** the ruling and its numbers go into an SCL that amends SCL-269.

If `rate_limited` or `upstream_error` dominate query 3, the timeout is not the lever. Look at
quota or the model's availability instead.
