-- ===========================================================================
-- E1 — drop the pre-baseline full-length exam config tables
-- ===========================================================================
-- @spec [Doc 02B V4 §17 (Full-Length Exam Engine) / §18 (Adaptive Module 2
--        Routing) — the sections these tables were seeded against in
--        20260610000000_ws2_config_constants.sql; Doc 04 Parent V3.0 (LOCKED
--        2026-05-12) + Doc 04A/04B V4.3/04C/04D — the family that now OWNS the
--        full-length runtime, scoring and routing; E1 exam deletion ruling,
--        2026-09-23] | @implemented [2026-09-23]
--
-- plain English: drops `exam_runtime_config`, `exam_runtime_config_history`,
-- `full_length_adaptive_config` and `full_length_adaptive_config_history`,
-- plus their `<name>_notify` and `<name>_history_no_mutate` triggers.
--
-- WHY. Both config tables were seeded against Doc 02B §17/§18 (full-length
-- timings; Module-2 routing thresholds) and carry no authority under the Doc 04
-- family, which owns the exam runtime, scoring constants (04B V4.3
-- `scoring_constants`, sealed by trigger) and routing. Their only reader was
-- apps/api/src/services/fullLengthExam.ts, deleted in the same change along with
-- the /api/full-length router. Keeping them would leave two sources for exam
-- constants the moment the Doc 04 rebuild lands its own.
--
-- WHAT THIS DOES NOT TOUCH. The shared trigger functions
-- `public.notify_config_change()` and `public.prevent_update_delete()` — every
-- other *_config table uses them. `review_schedule.source_engine`'s
-- `full_length` value, `apply_mastery_event`'s `full_length_answer` source kind,
-- `mastery_event_audit_log`'s CHECK, `usage_rate_limit_ledger`'s scope CHECK and
-- every calendar object accepting `full_length` are unchanged.
--
-- DELETION-CASCADE SAFETY (checked before writing this file). The operator-FK
-- preflight loop that once iterated a VALUES list naming these four tables with
-- dynamic `EXECUTE format('SELECT ... FROM public.%I ...')` was removed by
-- 20260917130000_declarative_fk_delete_actions.sql, whose
-- `execute_account_deletion_cascade` is the latest definition and relies on the
-- ON DELETE SET NULL operator FKs instead. On a fresh apply no function body in
-- pg_proc names these tables, no view depends on them, and they have no inbound
-- foreign keys; their two outbound FKs into `profiles` go with them. The
-- older VALUES lists (05d, 05e, drop_notification_outbox, deletion_evidence_bundle)
-- are superseded definitions and never run again.
--
-- trade-offs: the seeded values (5 exam timing rows, 3 Module-2 threshold rows)
-- are discarded. They are recoverable from 20260610000000 and from Doc 02B, and
-- the Doc 04 rebuild must source its constants from Doc 04B, not from these.
--
-- edge cases: IF EXISTS on every drop so a database where an operator already
-- removed a table still applies cleanly. No CASCADE — if anything unexpected
-- depends on these tables the drop fails loudly instead of silently taking it
-- with it. LYCEON-MIGRATION-REVIEWED
-- ===========================================================================

BEGIN;

-- History tables first (append-only; each carries a <name>_history_no_mutate trigger).
DROP TRIGGER IF EXISTS exam_runtime_config_history_no_mutate
  ON public.exam_runtime_config_history;
DROP TRIGGER IF EXISTS full_length_adaptive_config_history_no_mutate
  ON public.full_length_adaptive_config_history;
DROP TABLE IF EXISTS public.exam_runtime_config_history;
DROP TABLE IF EXISTS public.full_length_adaptive_config_history;

-- Config tables (each carries a <name>_notify trigger).
DROP TRIGGER IF EXISTS exam_runtime_config_notify
  ON public.exam_runtime_config;
DROP TRIGGER IF EXISTS full_length_adaptive_config_notify
  ON public.full_length_adaptive_config;
DROP TABLE IF EXISTS public.exam_runtime_config;
DROP TABLE IF EXISTS public.full_length_adaptive_config;

COMMIT;
