-- ============================================================================
-- MIGRATION INVENTORY — is each unrecorded version APPLIED or NOT APPLIED?
-- ============================================================================
-- READ-ONLY. One statement. One row per migration FILE (not per version — see
-- the duplicate-version note below), and one VERDICT PER ROW rather than one for
-- the file. That is the point: the deliverable is a per-file decision, because
-- the two classes need opposite treatments and a single summary line would have
-- to average them into something that is right for neither.
--
-- Read the verdict column top to bottom. Any row beginning STOP blocks that
-- version — and while any STOP remains, `supabase db push` is unsafe for ALL of
-- them, because push acts on the whole pending set rather than on one version.
--
-- COMPLETENESS IS THE POINT. Every unrecorded version appears, including the
-- ones another gate proves and the one that is genuinely new. A version absent
-- from an inventory reads as "nothing to do" — the same mistake in a quieter form.
--
-- WHY THIS EXISTS
--   supabase_migrations.schema_migrations stops at 20260624020000 (16 rows).
--   Everything after it renders in `supabase migration list` as Local with a
--   blank Remote — and that rendering is IDENTICAL for two opposite situations:
--
--     APPLIED-UNRECORDED  the objects are live; the runner just never wrote the
--                         row. Treatment: `supabase migration repair`.
--     NOT-APPLIED         the objects were never created. Treatment: `db push`.
--
--   Guessing wrong is damaging in both directions. Repairing a NOT-APPLIED
--   version means the runner skips it forever and its objects never exist.
--   Pushing an APPLIED one re-runs CREATE TABLE / ADD CONSTRAINT against
--   objects that are already there and fails mid-run.
--
-- HOW A CLASSIFICATION IS EARNED
--   Never by filename, never by commit history. Each row names a DISCRIMINATOR:
--   an object or property that this specific migration introduces, that nothing
--   before it had, and that nothing after it removes. The `kind` column says how
--   much that discriminator is worth:
--
--     unique      a new object no other migration creates. Present ⇒ applied.
--     body        the object predates this migration, but this migration changed
--                 its definition in a way still visible in pg_get_functiondef /
--                 indexdef / reloptions. Present ⇒ applied.
--     absence     the migration's visible effect is the REMOVAL of something.
--                 Weaker: another actor could have removed it. Reported as such.
--     chain-head  presence proves this migration OR a later one that replaces the
--                 same object ran. Cannot separate them alone; read with the
--                 later row.
--     unique-rows the migration has no DDL at all; the rows it INSERTs are its
--                 only trace. Present ⇒ applied; a partial count is neither class
--                 and is reported as PARTIAL.
--     superseded-verified
--                 a later migration DROPs and re-creates the same object with the
--                 same name and signature, leaving nothing of this one behind, AND
--                 that successor is verified present. Nothing of this migration
--                 survives to probe, so the probe is the SUCCESSOR's. Recordable
--                 under the narrow rule stated at its row — never on the
--                 supersession claim alone.
--     parity      covered object-by-object by migration-schema-parity.sql. The row
--                 exists so the inventory is complete; the verdict defers.
--     inert       every object the migration declares already exists in genesis
--                 and every statement is IF NOT EXISTS. No discriminator exists
--                 and none is needed: applying it and recording it reach the same
--                 schema, so the choice cannot do damage.
--
-- DUPLICATE VERSIONS — RESOLVED 2026-08-18
--   Three version strings were claimed by two files each. schema_migrations.version
--   is a primary key, so at most one row per pair could ever be recorded and
--   `repair` had no way to say which file it meant. Under the owner ruling of
--   2026-08-18 the LISA-lane file in each pair was renumbered to the next free
--   slot the same day, preserving apply order:
--     20260806000000_tutor_dedicated_roles            -> 20260806010000
--     20260807000000_ws_l2_context_config_keys        -> 20260807010000
--     20260812000000_tutor_messages_idempotency_role  -> 20260812010000
--   Every version below is now unique. See MIGRATION-VERSION-COLLISIONS.md.
--
-- THE SEVEN FROM 20260816/20260817 ARE LISTED BUT NOT RE-PROVEN HERE
--   They already have a stronger, object-by-object gate:
--   migration-schema-parity.sql (28 checks). Their rows below carry a
--   one-object presence probe purely so that this file is a COMPLETE inventory —
--   a version missing from an inventory reads as "nothing to do" — and their
--   verdict defers to the parity gate rather than competing with it.
--
-- WHAT THIS FILE ASSUMES EXISTS
--   The RECORDED baseline: genesis plus the 16 migrations through
--   20260624020000 — exactly what schema_migrations claims for prod. Two probes
--   read rows (practice_runtime_config, tutor_context_runtime_config); both
--   tables come from the RECORDED 20260610000000. Everything else is
--   catalog-only.
--
--   No probe touches a table that an UNRECORDED migration creates. That is a
--   deliberate constraint, not an accident: in Postgres a missing relation is a
--   PARSE error, so one such probe would take all 29 rows down to report a
--   single unknown.
-- ============================================================================

WITH probes(version, file, workstream, discriminator, kind, present) AS (
  VALUES

  -- ── mastery / 05D ─────────────────────────────────────────────────────────
  ('20260625000000', '05d_backfill_recompute', 'mastery (05D)',
   'function backfill_recompute_student(uuid, timestamptz)', 'unique',
   (to_regprocedure('public.backfill_recompute_student(uuid, timestamptz)') IS NOT NULL)),

  -- ── account deletion / 05D ────────────────────────────────────────────────
  -- Its function is replaced by 20260626010000, so the function alone proves
  -- nothing about THIS version. What only this version does is drop two FKs.
  ('20260625010000', '05d_account_deletion_cascade', 'account deletion (05D)',
   'audit_logs_actor_profile_id_fkey and audit_logs_target_profile_id_fkey both dropped', 'absence',
   ((to_regclass('public.audit_logs') IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM pg_constraint
                     WHERE conrelid = to_regclass('public.audit_logs')
                       AND conname IN ('audit_logs_actor_profile_id_fkey',
                                       'audit_logs_target_profile_id_fkey')))),

  -- ── actor-id substrate / 05E ──────────────────────────────────────────────
  ('20260625020000', '05e_actor_id_substrate', 'actor-id (05E)',
   'table anonymized_actors + profiles.actor_id + unique index idx_profiles_actor_id', 'unique',
   ((to_regclass('public.anonymized_actors') IS NOT NULL)
    AND (to_regclass('public.idx_profiles_actor_id') IS NOT NULL)
    AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'profiles'
                   AND column_name = 'actor_id'))),

  -- Replaces apply_mastery_event and refresh_domain_mastery only — no new
  -- object. But actor_id cannot appear in the 20260625000000 body (the column
  -- did not exist yet), so the live body naming it is unambiguous.
  ('20260625030000', '05e_actor_id_write_path', 'actor-id (05E)',
   'apply_mastery_event body writes actor_id', 'body',
   (COALESCE((SELECT pg_get_functiondef(p.oid) FROM pg_proc p
               WHERE p.oid = to_regprocedure(
                 'public.apply_mastery_event(uuid, text, text, text, smallint, text, text, boolean, timestamptz, uuid, text, text)')),
             '') LIKE '%actor_id%')),

  ('20260625040000', '05e_actor_id_backfill_seal', 'actor-id (05E)',
   'practice_sessions.actor_id and mastery_event_audit_log.actor_id are NOT NULL', 'unique',
   ((SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'actor_id'
        AND is_nullable = 'NO'
        AND table_name IN ('practice_sessions', 'practice_session_items',
                           'review_sessions', 'review_session_items',
                           'review_error_attempts', 'mastery_event_audit_log',
                           'mastery_domain_refresh_audit_log')) = 7)),

  -- ── account deletion / 05E + 04A ──────────────────────────────────────────
  ('20260626010000', '05e_anonymize_disposition', 'account deletion (05E)',
   'execute_account_deletion_cascade body writes anonymized_actors', 'body',
   (COALESCE((SELECT pg_get_functiondef(p.oid) FROM pg_proc p
               WHERE p.oid = to_regprocedure('public.execute_account_deletion_cascade(uuid, text)')),
             '') LIKE '%anonymized_actors%')),

  ('20260626020000', '04a_atomic_complete_and_anonymize', 'account deletion (04A)',
   'function complete_and_anonymize_account(uuid, uuid) exists', 'chain-head',
   (to_regprocedure('public.complete_and_anonymize_account(uuid, uuid)') IS NOT NULL)),

  ('20260627010000', '04a1_complete_and_anonymize_row_count', 'account deletion (04A)',
   'complete_and_anonymize_account body carries the ROW_COUNT guard', 'body',
   (COALESCE((SELECT pg_get_functiondef(p.oid) FROM pg_proc p
               WHERE p.oid = to_regprocedure('public.complete_and_anonymize_account(uuid, uuid)')),
             '') LIKE '%request not pending%')),

  -- ── practice engine / Vertical A ──────────────────────────────────────────
  -- practice_runtime_config comes from the RECORDED 20260610000000, so reading
  -- its rows is safe at the baseline this file assumes.
  ('20260627020000', 'verticalA_config_updates', 'practice engine (Vertical A)',
   'practice_runtime_config holds answer_rate_limit_max, answer_rate_limit_window_ms, max_concurrent_sessions', 'unique',
   ((SELECT count(*) FROM public.practice_runtime_config
      WHERE key IN ('answer_rate_limit_max', 'answer_rate_limit_window_ms',
                    'max_concurrent_sessions')) = 3)),

  -- Owner ruling 2026-08-18: a superseded migration is safe to SKIP — that is,
  -- to record without applying — when a later migration fully replaces its
  -- objects AND that replacement is verified present. Narrow, and conditional on
  -- the second half: `present` below is the SUCCESSOR's discriminator, so if
  -- 20260724000000 is not itself applied, this row does not claim skippability.
  -- Not a general licence to record unapplied migrations.
  ('20260627030000', 'practice_select_pool_random', 'practice engine (Vertical A)',
   'successor 20260724000000 verified present (it DROPs and re-creates select_practice_pool_random with the same signature, leaving nothing of this one behind)', 'superseded-verified',
   (((SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'practice_session_items'
         AND column_name IN ('question_assets', 'question_estimated_time_seconds')) = 2)
    AND (to_regprocedure(
      'public.select_practice_pool_random(text[], text[], text[], int[], text[], integer)') IS NOT NULL))),

  ('20260628010000', 'grid_in_schema_extension', 'question bank',
   'questions.item_type + constraint questions_item_shape_chk', 'unique',
   (EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'questions'
               AND column_name = 'item_type')
    AND EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = to_regclass('public.questions')
                   AND conname = 'questions_item_shape_chk'))),

  -- Its mode CHECK is superseded by 20260806000000_diagnostic_gate, but the
  -- three shuffle columns it adds are its own and nothing later drops them.
  ('20260629000000', 'vertical_a_schema_reconcile', 'practice engine (Vertical A)',
   'practice_session_items.option_order, option_token_map, client_instance_id', 'unique',
   ((SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'practice_session_items'
        AND column_name IN ('option_order', 'option_token_map', 'client_instance_id')) = 3)),

  ('20260630000000', 'practice_quota_rpc', 'entitlement / quota',
   'table usage_rate_limit_ledger + function check_and_reserve_practice_quota', 'unique',
   ((to_regclass('public.usage_rate_limit_ledger') IS NOT NULL)
    AND (to_regprocedure(
      'public.check_and_reserve_practice_quota(uuid, uuid, uuid, uuid, boolean, text, timestamptz)') IS NOT NULL))),

  ('20260708000000', 'practice_grid_in_columns', 'practice engine (Vertical A)',
   'practice_session_items.question_item_type + constraint psi_item_shape_chk', 'unique',
   (EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'practice_session_items'
               AND column_name = 'question_item_type')
    AND EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = to_regclass('public.practice_session_items')
                   AND conname = 'psi_item_shape_chk'))),

  ('20260722000000', 'practice_pool_passage_col', 'practice engine (Vertical A)',
   'successor 20260724000000 verified present (its only statement re-creates select_practice_pool_random, which 20260724000000 then DROPs and re-creates)', 'superseded-verified',
   (((SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'practice_session_items'
         AND column_name IN ('question_assets', 'question_estimated_time_seconds')) = 2)
    AND (to_regprocedure(
      'public.select_practice_pool_random(text[], text[], text[], int[], text[], integer)') IS NOT NULL))),

  -- ── content pipeline ──────────────────────────────────────────────────────
  ('20260724000000', 'content_pipeline_columns', 'content pipeline',
   'practice_session_items.question_assets + question_estimated_time_seconds', 'unique',
   ((SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'practice_session_items'
        AND column_name IN ('question_assets', 'question_estimated_time_seconds')) = 2)),

  ('20260724010000', 'servable_questions_security', 'content pipeline',
   'view servable_questions carries security_invoker=true', 'body',
   (COALESCE((SELECT 'security_invoker=true' = ANY (c.reloptions)
                FROM pg_class c WHERE c.oid = to_regclass('public.servable_questions')),
             false))),

  -- ── LISA / tutor runtime ──────────────────────────────────────────────────
  ('20260805000000', 'ws_l0_3_tutor_runtime_schema', 'LISA (tutor runtime)',
   'tables tutor_conversations, tutor_messages, tutor_memory_summaries', 'unique',
   ((to_regclass('public.tutor_conversations') IS NOT NULL)
    AND (to_regclass('public.tutor_messages') IS NOT NULL)
    AND (to_regclass('public.tutor_memory_summaries') IS NOT NULL))),

  -- ── 20260806 — the collision pair, renumbered 2026-08-18 ─────────────────
  ('20260806000000', 'diagnostic_gate', 'diagnostic',
   'functions select_diagnostic_pool(integer, text[]) + practice_session_mode_to_event_kind(text)', 'unique',
   ((to_regprocedure('public.select_diagnostic_pool(integer, text[])') IS NOT NULL)
    AND (to_regprocedure('public.practice_session_mode_to_event_kind(text)') IS NOT NULL))),

  -- The five roles ALONE are not a valid probe: pg_roles is CLUSTER-global, so a
  -- role created by any other database in the same cluster satisfies it. Caught
  -- by the negative control, which reported APPLIED against a database the
  -- migration had never touched. The policy is per-database and per-migration,
  -- so both halves are required.
  ('20260806010000', 'tutor_dedicated_roles', 'LISA (tutor roles)',
   'five tutor_* roles AND policy tutor_conversations_runtime_insert', 'unique',
   (((SELECT count(*) FROM pg_roles
       WHERE rolname IN ('tutor_runtime_writer', 'tutor_memory_writer',
                         'tutor_archival_writer', 'tutor_injection_writer',
                         'tutor_context_reader')) = 5)
    AND EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname = 'public' AND tablename = 'tutor_conversations'
                   AND policyname = 'tutor_conversations_runtime_insert'))),

  -- Its unique index is re-created by 20260812010000_tutor_messages_idempotency_role;
  -- the policy is its own.
  ('20260806020000', 'tutor_schema_proof_fixes', 'LISA (tutor runtime)',
   'policy tutor_injection_log_select_own on tutor_injection_log', 'unique',
   (EXISTS (SELECT 1 FROM pg_policies
             WHERE schemaname = 'public' AND tablename = 'tutor_injection_log'
               AND policyname = 'tutor_injection_log_select_own'))),

  -- ── 20260807 — the collision pair, renumbered 2026-08-18 ─────────────────
  ('20260807000000', 'diagnostic_pool_plain_invoker', 'diagnostic',
   'select_diagnostic_pool is SECURITY INVOKER (20260806000000 created it DEFINER)', 'body',
   (COALESCE((SELECT p.prosecdef = false FROM pg_proc p
               WHERE p.oid = to_regprocedure('public.select_diagnostic_pool(integer, text[])')),
             false))),

  -- No DDL at all — five config rows are the only trace this migration leaves.
  -- tutor_context_runtime_config is from the RECORDED 20260610000000, so this
  -- read is safe at the assumed baseline. A count between 1 and 4 is neither
  -- class: the migration is a single INSERT block, so a partial result means
  -- something outside it wrote or deleted these rows.
  ('20260807010000', 'ws_l2_context_config_keys', 'LISA (context config)',
   'five tutor_context_runtime_config freshness/threshold keys', 'unique-rows',
   ((SELECT count(*) FROM public.tutor_context_runtime_config
      WHERE key IN ('study_context_freshness_days',
                    'teaching_profile_freshness_days',
                    'recent_learning_pattern_freshness_days',
                    'observation_promotion_threshold',
                    'friction_long_pause_seconds')) = 5)),

  -- ── billing ───────────────────────────────────────────────────────────────
  -- No discriminator exists, and that is the finding rather than a gap in the
  -- probe: BOTH objects this migration declares are already created by genesis,
  -- and every statement in the file is IF NOT EXISTS / ENABLE RLS. It is a
  -- no-op against any genesis-derived database. Recording it and pushing it
  -- reach the same schema, so this is the one version where the choice cannot
  -- do damage. The negative control found this by reporting APPLIED against a
  -- database the migration had never touched.
  ('20260809000000', 'entitlements_profile_id_unique_and_webhook_events', 'billing (Stripe)',
   'none — stripe_webhook_events and entitlements_profile_id_unique both come from genesis; every statement is IF NOT EXISTS', 'inert',
   false),

  -- ── 20260812 — the collision pair, renumbered 2026-08-18 ─────────────────
  ('20260812000000', 'snapshot_kind_baseline', 'diagnostic baseline',
   'student_section_projection_snapshots.snapshot_kind + index idx_baseline_once_per_student_section', 'unique',
   (EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'student_section_projection_snapshots'
               AND column_name = 'snapshot_kind')
    AND (to_regclass('public.idx_baseline_once_per_student_section') IS NOT NULL))),

  ('20260812010000', 'tutor_messages_idempotency_role', 'LISA (tutor runtime)',
   'idx_tutor_messages_client_turn_idempotency includes the role column (20260806020000 created it without)', 'body',
   (COALESCE((SELECT i.indexdef LIKE '%, role)%' FROM pg_indexes i
               WHERE i.schemaname = 'public'
                 AND i.indexname = 'idx_tutor_messages_client_turn_idempotency'),
             false))),

  -- ── LISA crisis + memory (files live ONLY on the lisa branch) ─────────────
  ('20260813000000', 'crisis_review_queue', 'LISA (crisis review)',
   'tables crisis_review_cases + crisis_review_audit_log', 'unique',
   ((to_regclass('public.crisis_review_cases') IS NOT NULL)
    AND (to_regclass('public.crisis_review_audit_log') IS NOT NULL))),

  ('20260814000000', 'crisis_audit_log_nullable_case_id', 'LISA (crisis review)',
   'crisis_review_audit_log.case_id and conversation_id are both nullable', 'absence',
   ((SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'crisis_review_audit_log'
        AND column_name IN ('case_id', 'conversation_id')
        AND is_nullable = 'YES') = 2)),

  ('20260815000000', 'memory_summary_notify_function', 'LISA (memory)',
   'function pg_notify_memory_summary(uuid, text)', 'unique',
   (to_regprocedure('public.pg_notify_memory_summary(uuid, text)') IS NOT NULL)),

  -- ── the seven — presence only; migration-schema-parity.sql is the gate ────
  ('20260816000000', 'psi_occurred_at_backfill_and_seal', 'mastery unblock',
   'table psi_occurred_at_backfill_log + CHECK psi_resolved_requires_occurred_at', 'parity',
   ((to_regclass('public.psi_occurred_at_backfill_log') IS NOT NULL)
    AND EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'psi_resolved_requires_occurred_at'))),

  ('20260816010000', 'canonical_domain_checks', 'question bank',
   'CHECKs questions_domain_section_canonical + psi_question_domain_section_canonical', 'parity',
   ((SELECT count(*) FROM pg_constraint
      WHERE conname IN ('questions_domain_section_canonical',
                        'psi_question_domain_section_canonical')) = 2)),

  ('20260816020000', 'mastery_derivation_gap_detection', 'mastery observability',
   'views mastery_derivation_gaps/_summary + ledger + idx_mastery_gap_ledger_observed_at + record_mastery_derivation_gap()', 'parity',
   ((to_regclass('public.mastery_derivation_gaps') IS NOT NULL)
    AND (to_regclass('public.mastery_derivation_gap_ledger') IS NOT NULL)
    AND (to_regclass('public.idx_mastery_gap_ledger_observed_at') IS NOT NULL)
    AND (to_regprocedure('public.record_mastery_derivation_gap()') IS NOT NULL))),

  ('20260817000000', 'diagnostic_once_only_index', 'session lifecycle',
   'unique index practice_sessions_one_completed_diagnostic_uq', 'parity',
   (to_regclass('public.practice_sessions_one_completed_diagnostic_uq') IS NOT NULL)),

  ('20260817010000', 'student_diagnostic_state', 'session lifecycle',
   'view student_diagnostic_states + function student_diagnostic_state(uuid)', 'parity',
   ((to_regclass('public.student_diagnostic_states') IS NOT NULL)
    AND (to_regprocedure('public.student_diagnostic_state(uuid)') IS NOT NULL))),

  ('20260817020000', 'practice_session_abandoned_at', 'session lifecycle',
   'practice_sessions.abandoned_at + CHECK practice_sessions_abandoned_not_completed', 'parity',
   (EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'practice_sessions'
               AND column_name = 'abandoned_at')
    AND EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'practice_sessions_abandoned_not_completed'))),

  ('20260817030000', 'student_baseline_pending', 'session lifecycle',
   'view student_baseline_pending', 'parity',
   (to_regclass('public.student_baseline_pending') IS NOT NULL)),

  -- ── genuinely new: authored in PR #608, never applied anywhere ────────────
  ('20260818000000', 'gap_detector_excludes_backfilled', 'mastery observability',
   'mastery_derivation_gaps both branches exclude backfill_recompute events', 'unique',
   (COALESCE((SELECT (pg_get_viewdef(c.oid) LIKE '%pi.occurred_at <= ral.applied_at%')
                 AND (pg_get_viewdef(c.oid) LIKE '%ra.occurred_at <= ral.applied_at%')
                FROM pg_class c WHERE c.oid = to_regclass('public.mastery_derivation_gaps')),
             false)))
)
SELECT
  p.version,
  p.file,
  p.workstream,
  p.discriminator,
  p.kind                                                        AS evidence_kind,
  p.present                                                     AS discriminator_present,
  CASE
    WHEN p.kind = 'superseded-verified'
      THEN CASE WHEN p.present THEN 'SUPERSEDED (successor verified)'
                ELSE 'UNKNOWN — successor absent, so supersession is unproven' END
    WHEN p.kind = 'inert'      THEN 'INERT — no-op either way'
    WHEN p.present             THEN 'APPLIED-UNRECORDED'
    WHEN p.kind = 'unique-rows'
         AND (SELECT count(*) FROM public.tutor_context_runtime_config
               WHERE key IN ('study_context_freshness_days',
                             'teaching_profile_freshness_days',
                             'recent_learning_pattern_freshness_days',
                             'observation_promotion_threshold',
                             'friction_long_pause_seconds')) > 0
      THEN 'PARTIAL — some rows present, some missing; investigate'
    ELSE                            'NOT-APPLIED'
  END                                                           AS classification,
  CASE
    WHEN p.kind = 'superseded-verified' AND p.present
      THEN 'REPAIR — safe to skip: a later migration fully replaces its objects AND that replacement is verified present. Both halves required; not a general licence'
    WHEN p.kind = 'superseded-verified'
      THEN 'STOP — the successor is NOT present, so nothing proves this was superseded rather than never applied'
    WHEN p.kind = 'parity'
      THEN 'REPAIR — but only after migration-schema-parity.sql returns OK; that gate is 28 object-level checks and outranks this row'
    WHEN p.kind = 'inert'
      THEN 'OK — repair or push, both reach the same schema; repair preferred, it keeps the runner quiet'
    WHEN p.present AND p.kind = 'absence'
      THEN 'REPAIR (confirm first) — the evidence is a REMOVAL, which another actor could also have caused'
    WHEN p.present AND p.kind = 'chain-head'
      THEN 'REPAIR (confirm first) — read with the later row that replaces the same object'
    WHEN p.present
      THEN 'REPAIR — supabase migration repair --status applied ' || p.version
    WHEN p.kind = 'unique-rows'
         AND (SELECT count(*) FROM public.tutor_context_runtime_config
               WHERE key IN ('study_context_freshness_days',
                             'teaching_profile_freshness_days',
                             'recent_learning_pattern_freshness_days',
                             'observation_promotion_threshold',
                             'friction_long_pause_seconds')) > 0
      THEN 'STOP — partial row set; something outside the migration wrote or deleted these rows'
    ELSE 'PUSH — genuinely pending, but only via a push scoped to versions classified this way'
  END                                                           AS verdict
FROM probes p
ORDER BY p.version, p.file;
