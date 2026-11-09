-- ===========================================================================
-- Crisis classifier Layer 2: daily degraded rate, latency and failure reasons
-- (owner brief "Crisis classifier: record the failure reason, and look at the timeout",
-- Karl 2026-11-08; SCL-276). READ-ONLY. Run by hand in the SQL editor; nothing here writes.
-- ===========================================================================
-- Source: public.tutor_turn_metrics, one row per turn. Codes and counts only.
--
-- Definitions:
--   Layer 2 ran  — crisis_classifier_outcome is set and is not 'no_crisis_signatures_only'
--                  (an exact-label tap runs Layer 1 only) — the denominator.
--   degraded     — outcome 'classifier_degraded' (Layer 2 failed, Layer 1 had signatures: the
--                  turn proceeded, force-reviewed) or 'classifier_degraded_no_floor' (Layer 2
--                  failed and Layer 1 was empty: the crisis path). Both are human review.
--   infra        — outcome 'infrastructure_failure' (the whole pipeline threw), shown apart.
--   latency      — crisis_classifier_ms: Layer 2's wall time across attempts and setup. Set from
--                  20261202000000 on; earlier rows have none, so query 2 starts at the deploy.
-- Day = UTC.
-- ===========================================================================

-- 1. Degraded rate per day (works on history: the outcome column predates this change).
--    The 2026-11-08 baseline is 1 degraded turn in 123 over 7 days.
SELECT date_trunc('day', recorded_at)::date AS day,
       count(*) FILTER (WHERE crisis_classifier_outcome IS NOT NULL
                          AND crisis_classifier_outcome <> 'no_crisis_signatures_only')
         AS layer2_turns,
       count(*) FILTER (WHERE crisis_classifier_outcome IN
                          ('classifier_degraded', 'classifier_degraded_no_floor'))
         AS degraded_turns,
       round(
         count(*) FILTER (WHERE crisis_classifier_outcome IN
                            ('classifier_degraded', 'classifier_degraded_no_floor'))::numeric
         / nullif(count(*) FILTER (WHERE crisis_classifier_outcome IS NOT NULL
                                     AND crisis_classifier_outcome <> 'no_crisis_signatures_only'), 0),
         4) AS degraded_rate,
       count(*) FILTER (WHERE crisis_classifier_outcome = 'infrastructure_failure')
         AS infra_failures
FROM public.tutor_turn_metrics
WHERE recorded_at >= now() - interval '7 days'
GROUP BY 1
ORDER BY 1 DESC;

-- 1b. The same over the whole window (the baseline line).
SELECT count(*) FILTER (WHERE crisis_classifier_outcome IN
                          ('classifier_degraded', 'classifier_degraded_no_floor')) AS degraded_turns,
       count(*) FILTER (WHERE crisis_classifier_outcome IS NOT NULL
                          AND crisis_classifier_outcome <> 'no_crisis_signatures_only') AS layer2_turns
FROM public.tutor_turn_metrics
WHERE recorded_at >= now() - interval '7 days';

-- 2. Layer 2 latency per day, in ms. `first_try` is the timeout's own population: turns where the
--    first attempt answered (1 attempt, no reason). `all` includes retries and failures.
SELECT date_trunc('day', recorded_at)::date AS day,
       count(*) FILTER (WHERE crisis_classifier_attempts = 1 AND crisis_degraded_reason IS NULL)
         AS first_try_n,
       percentile_cont(0.50) WITHIN GROUP (ORDER BY crisis_classifier_ms)
         FILTER (WHERE crisis_classifier_attempts = 1 AND crisis_degraded_reason IS NULL) AS first_try_p50,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY crisis_classifier_ms)
         FILTER (WHERE crisis_classifier_attempts = 1 AND crisis_degraded_reason IS NULL) AS first_try_p95,
       percentile_cont(0.99) WITHIN GROUP (ORDER BY crisis_classifier_ms)
         FILTER (WHERE crisis_classifier_attempts = 1 AND crisis_degraded_reason IS NULL) AS first_try_p99,
       max(crisis_classifier_ms)
         FILTER (WHERE crisis_classifier_attempts = 1 AND crisis_degraded_reason IS NULL) AS first_try_max,
       count(*) AS all_n,
       percentile_cont(0.50) WITHIN GROUP (ORDER BY crisis_classifier_ms) AS all_p50,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY crisis_classifier_ms) AS all_p95,
       percentile_cont(0.99) WITHIN GROUP (ORDER BY crisis_classifier_ms) AS all_p99,
       count(*) FILTER (WHERE crisis_classifier_attempts = 2) AS retried
FROM public.tutor_turn_metrics
WHERE crisis_classifier_ms IS NOT NULL
  AND recorded_at >= now() - interval '7 days'
GROUP BY 1
ORDER BY 1 DESC;

-- 2b. The timeout recommendation's input: first-try latency over the whole window.
SELECT count(*) AS first_try_n,
       percentile_cont(0.50)  WITHIN GROUP (ORDER BY crisis_classifier_ms) AS p50,
       percentile_cont(0.95)  WITHIN GROUP (ORDER BY crisis_classifier_ms) AS p95,
       percentile_cont(0.99)  WITHIN GROUP (ORDER BY crisis_classifier_ms) AS p99,
       percentile_cont(0.999) WITHIN GROUP (ORDER BY crisis_classifier_ms) AS p999,
       max(crisis_classifier_ms) AS max
FROM public.tutor_turn_metrics
WHERE crisis_classifier_ms IS NOT NULL
  AND crisis_classifier_attempts = 1
  AND crisis_degraded_reason IS NULL
  AND recorded_at >= now() - interval '7 days';

-- 3. Why Layer 2 failed, per day (turn rows), and on the review cases opened by it.
SELECT date_trunc('day', recorded_at)::date AS day,
       crisis_degraded_reason AS reason,
       crisis_classifier_attempts AS attempts,
       count(*) AS turns
FROM public.tutor_turn_metrics
WHERE crisis_degraded_reason IS NOT NULL
  AND recorded_at >= now() - interval '7 days'
GROUP BY 1, 2, 3
ORDER BY 1 DESC, 4 DESC;

SELECT date_trunc('day', created_at)::date AS day, source, degraded_reason, classifier_attempts,
       count(*) AS cases
FROM public.crisis_review_cases
WHERE source IN ('classifier_degraded', 'classifier_degraded_no_floor')
  AND created_at >= now() - interval '7 days'
GROUP BY 1, 2, 3, 4
ORDER BY 1 DESC;
