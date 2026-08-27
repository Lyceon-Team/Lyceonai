-- ---------------------------------------------------------------------------
-- LYCEON-MIGRATION-REVIEWED
--
-- Explicit service_role grants — make genesis a complete, self-describing record.
--
-- @spec [Owner ruling 2026-08-27; v2 work block §2 genesis parity]
-- @implemented [2026-08-27]
--
-- plain English: production grants service_role on 18 public tables, 3 sequences
-- and 5 functions that no migration mentions. This writes those grants down so
-- the repository states them instead of inheriting them silently.
--
-- WHY THEY WERE MISSING — an invisible platform default, not a lost migration:
--
--   SELECT pg_get_userbyid(defaclrole), defaclobjtype, defaclacl FROM pg_default_acl;
--
--   set_by=postgres  public  table     {postgres=arwdDxtm/postgres, service_role=arwdDxtm/postgres}
--   set_by=postgres  public  sequence  {postgres=rwU/postgres,      service_role=rwU/postgres}
--   set_by=postgres  public  function  {postgres=X/postgres,        service_role=X/postgres}
--
-- ALTER DEFAULT PRIVILEGES was run on `public` by role `postgres`, so every
-- object created there since acquires service_role privileges automatically.
--
-- That default names service_role ONLY — not anon, not authenticated. Which is
-- why those two matched genesis exactly (2 and 6 tables, granted explicitly in
-- migrations) while service_role did not. The asymmetry is the mechanism's
-- fingerprint, and it shows up in all three object classes.
--
-- Genesis must be a complete self-describing record. A privilege that exists
-- only because of an invisible platform default cannot be reviewed, cannot be
-- restored from the repo if that default changes, and is the same class of
-- defect as an implicit constant. Explicit grants make genesis the authority.
--
-- REDUNDANT IN PRODUCTION, NOT IN CI — and that is the point. In production
-- every grant below already exists via the default, so applying this re-grants
-- what is already held and changes no behaviour. Against a fresh apply — what
-- CI runs and what the parity gate compares — it is not a no-op. This changes
-- what the repository can prove, not what production does.
--
-- DELIBERATELY NOT DONE: this does not touch ALTER DEFAULT PRIVILEGES, and the
-- default is not replayed in scripts/ci/genesis-fresh-apply.sh's bootstrap.
-- Reproducing it locally would hide the very gap this closes.
--
-- SCOPE — 17 tables, not 18. `mastery_levels` is the eighteenth table carrying
-- a production service_role grant and is EXCLUDED: it does not exist in genesis
-- (one of the three accepted drifts, landing via its own PR), so a GRANT here
-- would fail on fresh apply. Its own PR must carry its own grant. Verified
-- absent from a fresh apply of all 53 migrations, 2026-08-27.
--
-- Views are not listed: servable_questions, student_diagnostic_states,
-- student_baseline_pending, mastery_derivation_gaps and
-- mastery_derivation_gap_summary carry service_role grants and already match.
--
-- rollback:
--   REVOKE ALL ON TABLE <each table below> FROM service_role;
--   REVOKE ALL ON SEQUENCE <each sequence below> FROM service_role;
--   REVOKE ALL ON FUNCTION <each function below> FROM service_role;
--
--   ASYMMETRIC — READ BEFORE RUNNING IN PRODUCTION. Against a fresh apply this
--   is an exact inverse and restores the pre-migration state. Against
--   PRODUCTION it is NOT: the default-derived privilege and the explicit grant
--   are the same ACL entry (same grantor `postgres`, same grantee), so a REVOKE
--   removes the privilege outright rather than peeling off a duplicate layer.
--   ALTER DEFAULT PRIVILEGES applies at CREATE time only and will not restore
--   it. Rolling back in production therefore strips privileges the service role
--   actively depends on. Roll back in CI freely; in production, only with that
--   understood and the grants re-applied deliberately afterwards.
-- ---------------------------------------------------------------------------

BEGIN;

-- Tables — production default is arwdDxtm, i.e. every table privilege.
GRANT ALL ON TABLE public.crisis_review_audit_log              TO service_role;
GRANT ALL ON TABLE public.crisis_review_cases                  TO service_role;
GRANT ALL ON TABLE public.exam_runtime_config_history          TO service_role;
GRANT ALL ON TABLE public.full_length_adaptive_config_history  TO service_role;
GRANT ALL ON TABLE public.mastery_constants_history            TO service_role;
GRANT ALL ON TABLE public.practice_runtime_config_history      TO service_role;
GRANT ALL ON TABLE public.review_runtime_config_history        TO service_role;
GRANT ALL ON TABLE public.tutor_context_runtime_config_history TO service_role;
GRANT ALL ON TABLE public.tutor_conversations                  TO service_role;
GRANT ALL ON TABLE public.tutor_injection_log                  TO service_role;
GRANT ALL ON TABLE public.tutor_injection_signatures           TO service_role;
GRANT ALL ON TABLE public.tutor_instruction_assignments        TO service_role;
GRANT ALL ON TABLE public.tutor_instruction_exposures          TO service_role;
GRANT ALL ON TABLE public.tutor_memory_summaries               TO service_role;
GRANT ALL ON TABLE public.tutor_messages                       TO service_role;
GRANT ALL ON TABLE public.tutor_question_links                 TO service_role;
GRANT ALL ON TABLE public.usage_rate_limit_ledger              TO service_role;

-- Sequences — production default is rwU = SELECT, UPDATE, USAGE. Genesis
-- granted none of the three explicitly; production holds service_role on all.
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.mastery_constants_change_log_change_id_seq           TO service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.projection_refresh_outbox_outbox_id_seq              TO service_role;
GRANT SELECT, UPDATE, USAGE ON SEQUENCE public.student_section_projection_snapshots_snapshot_id_seq TO service_role;

-- Functions — production default is X = EXECUTE. 48 of genesis's 53 already
-- grant it explicitly; these five ride the default. All are trigger/internal.
GRANT EXECUTE ON FUNCTION public.capture_mastery_constant_change() TO service_role;
GRANT EXECUTE ON FUNCTION public.crisis_review_cases_updated_at()  TO service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user()                 TO service_role;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column()        TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_memory_summary_schema()  TO service_role;

COMMIT;
