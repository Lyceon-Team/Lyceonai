-- @spec [Gap-Registry_V1.1, GAP-TU-09] [Gap-Registry_V1.1, GAP-HY-02] [Gap-Registry_V1.1, GAP-OP-05]
-- @implemented [2026-06-08]
-- plain English: WS-1 D4 — the single forward drop migration that rides on top of the
-- genesis baseline 00000000000000_baseline.sql. It removes the two proven-dead DB
-- surfaces carried into WS-1:
--   * GAP-TU-09: public.tutor_interactions — a 0-row, verbatim-bearing (message/answer
--     NOT NULL) audit side-table; runtime already reads the canonical tutor_messages.
--     Full-table drop strictly supersedes the never-applied 20260606 column-ALTER.
--   * GAP-HY-02: 16 caller-free orphan functions (verified zero repo callers; each
--     exists in capture 0000-supabase-live-20260607.csv B1). The bare `vectors` of the
--     registry is a no-op (the vectors TABLE is absent from prod) — no DROP authored.
-- Trade-offs / edge cases: every statement is IF EXISTS, so the migration is idempotent
-- and order-safe (no-op if an object is already gone). The 2 update_ingestion_v4_*
-- TRIGGER functions are included here (orphaned: no ingestion_v4_* table in prod, no D1
-- trigger references them); WS-7 retains only the ingestion_v4_* TABLE cleanup.

-- GAP-TU-09 — verbatim-bearing dead table (no inbound FK / RLS policy / trigger; 0 rows)
DROP TABLE IF EXISTS public.tutor_interactions;

-- GAP-HY-02 — 16 caller-free orphan functions
DROP FUNCTION IF EXISTS public.create_vectors_table_if_not_exists();
DROP FUNCTION IF EXISTS public.enqueue_render_pages_if_missing(uuid, text, text, text, text, integer);
DROP FUNCTION IF EXISTS public.enqueue_render_pages_if_missing(uuid, jsonb);
DROP FUNCTION IF EXISTS public.enqueue_render_pages_if_missing(uuid, boolean, jsonb);
DROP FUNCTION IF EXISTS public.enqueue_render_pages_if_missing_v2(uuid, jsonb, boolean);
DROP FUNCTION IF EXISTS public.match_vectors(vector, double precision, integer);
DROP FUNCTION IF EXISTS public.v4_acquire_worker_lock(text, timestamp with time zone);
DROP FUNCTION IF EXISTS public.v4_debug_queue_schema();
DROP FUNCTION IF EXISTS public.v4_increment_cluster_usage(uuid, integer);
DROP FUNCTION IF EXISTS public.v4_mark_style_pages_used(uuid[]);
DROP FUNCTION IF EXISTS public.v4_queue_reset_stale_locks(integer);
DROP FUNCTION IF EXISTS public.v4_release_worker_lock(text);
DROP FUNCTION IF EXISTS public.v4_renew_worker_lock(text, timestamp with time zone);
DROP FUNCTION IF EXISTS public.v4_set_primary_cluster(uuid, uuid, numeric);
DROP FUNCTION IF EXISTS public.update_ingestion_v4_jobs_updated_at();
DROP FUNCTION IF EXISTS public.update_ingestion_v4_queue_updated_at();

-- ----------------------------------------------------------------------------
-- LYCEON-MIGRATION-REVIEWED (INV-06: every-migration-has-rollback)
-- Rollback: these are proven-dead objects (zero callers; tutor_interactions 0 rows).
-- Their definitions are reproducible from the genesis baseline
-- (00000000000000_baseline.sql) / capture 0000-supabase-live-20260607.csv §B2. Rollback
-- is provenance-restore only — no runtime depends on any object dropped here.
-- ----------------------------------------------------------------------------
