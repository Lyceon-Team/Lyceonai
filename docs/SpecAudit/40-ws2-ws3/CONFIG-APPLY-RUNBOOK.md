# Config-constants apply — OWNER-RUN runbook

> Applies the genesis-extending config migration
> `supabase/migrations/20260610000000_ws2_config_constants.sql` (operational config for
> WS-2/WS-3 engines; SP-05 resolution). Owner-run; agents hold no `service_role`.
> Genesis-extending; the `genesis-fresh-apply` CI gate covers it (expected snapshot updated).

## Pre-flight
- WS-1 genesis is already applied (42 tables; migration row `00000000000000` recorded).
- The migration is **CREATE/seed only** — it adds 5 config tables + their `_history`, seeds
  exact spec values, and seeds 7 tutor-bucket keys into the existing `rate_limit_runtime_config`.

## Apply (tracked pipeline)
```bash
# owner, linked to the project:
supabase db push          # applies 20260610000000_ws2_config_constants.sql through the pipeline
```

## Verify (expect the seeded counts)
```sql
SELECT 'practice'    AS t, count(*) FROM public.practice_runtime_config        -- 8
UNION ALL SELECT 'review',        count(*) FROM public.review_runtime_config          -- 7
UNION ALL SELECT 'exam',          count(*) FROM public.exam_runtime_config            -- 5
UNION ALL SELECT 'full_length',   count(*) FROM public.full_length_adaptive_config    -- 3
UNION ALL SELECT 'tutor_ctx',     count(*) FROM public.tutor_context_runtime_config   -- 9
UNION ALL SELECT 'tutor_buckets', count(*) FROM public.rate_limit_runtime_config WHERE key LIKE 'tutor_%'; -- 7

-- spot-check (locked values)
SELECT key, value FROM public.practice_runtime_config WHERE key='daily_quota_free';       -- 40
SELECT key, value FROM public.review_runtime_config   WHERE key='sm2_initial_ease_factor'; -- 2.5
SELECT key, value FROM public.tutor_context_runtime_config WHERE key='cost_hard_cap_usd_month'; -- 20
```

## Rollback
```sql
-- DROP the 5 new tables + their _history, and remove the tutor-bucket keys.
DROP TABLE IF EXISTS public.practice_runtime_config, public.practice_runtime_config_history,
  public.review_runtime_config, public.review_runtime_config_history,
  public.exam_runtime_config, public.exam_runtime_config_history,
  public.full_length_adaptive_config, public.full_length_adaptive_config_history,
  public.tutor_context_runtime_config, public.tutor_context_runtime_config_history CASCADE;
DELETE FROM public.rate_limit_runtime_config WHERE key LIKE 'tutor_%';
```

## Not seeded (pending, by design — do not invent)
- `full_length_adaptive_config.rw_m1_threshold_raw_score` / `math_m1_threshold_raw_score` —
  PENDING product decision in Doc 02B §18 (lands with the full-length build wave).
- The baseline-diagnostic surface + `diagnostic_total_questions` — SP-12 (diagnostic surface
  absent from Doc 02B); seeded when that surface is pinned.
