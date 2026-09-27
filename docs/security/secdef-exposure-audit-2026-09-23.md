# SECURITY DEFINER Exposure Audit — 2026-09-23

> **Status:** read-only audit. Nothing was applied to production.
> **Scope:** every `SECURITY DEFINER` function in schema `public` in production (Supabase project `hncolwkccbbjkfithhlo`), and the same set on a fresh apply of `supabase/migrations` (PostgreSQL 16, the CI genesis bootstrap).
> **Deliverables:** `supabase/migrations/20261001000000_security_definer_revoke_public.sql` (not applied) and the CI gate `A.6` in `scripts/ci/genesis-fresh-apply.sh` + `scripts/ci/secdef-exposure.sql`.

## 0. Headline — the exposure is five functions, not 51, and only one was exploitable

The brief's table does not reproduce. Measured against production, 2026-09-23, after the guardian REVOKE:

| | Brief | Measured (prod) | Measured (fresh apply of the repo) |
|---|---|---|---|
| `SECURITY DEFINER` functions in `public` | 82 | **82** | **82** |
| Executable by PUBLIC / `anon` | 82 | **4** | **5** (the guardian function included) |
| Executable by `authenticated` | — | **5** | **6** |
| No `auth.uid/role/jwt` / `is_admin` / `current_student_id` in body | 79 | 79 | 79 |
| …of those, not trigger functions | 72 | 72 | 72 |
| …of those, VOLATILE | 51 | 51 | 51 |
| …of those, **executable by anon** | 51 | **0** | **1** (`create_active_guardian_link_audited`) |

The last four rows of the brief are right. The second row is not: 77 of the 82 functions carry an explicit `REVOKE ALL … FROM PUBLIC` in the migration that creates them, and production's ACLs show `postgres=X/postgres service_role=X/postgres`, meaning no PUBLIC entry. The query that settles it:

```sql
SELECT count(*) FILTER (WHERE has_function_privilege('anon', p.oid, 'EXECUTE'))
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosecdef;   -- prod 2026-09-23: 4
```

If the brief's count came from a different check (for example, treating a function with no PUBLIC entry as PUBLIC-by-default), that check is wrong for this database. If a bulk REVOKE ran between the brief's measurement and this one, that would also explain it. Either way, **the current state is as above.**

**The genuinely exploitable count is one, and it is the one already fixed:** `create_active_guardian_link_audited` (prod REVOKE by hand 2026-09-23). Nothing that writes entitlements, mastery, billing or crisis data is reachable with the anon key. The Part A stop condition was not triggered.

## A.1 — All 82, ordered by risk

Columns:
- **Writes** is parsed from `INSERT INTO` / `UPDATE` / `DELETE FROM` in the body.
- **Caller check** is a regex over the body for `auth.uid|jwt|role`.
- **Caller** is every non-test TypeScript reference in the repo. All of them go through the service-role client (`supabaseServer` / `getSupabaseAdmin`). **No `client/` code calls any RPC** (`git grep "\.rpc(" client/src` is empty).

| Function | Args | Volatility | What it writes | Caller check? | Legitimate caller | Reachable via PostgREST with anon key? | Exploitable with anon key? | Verdict |
|---|---|---|---|---|---|---|---|---|
| `create_active_guardian_link_audited` | `p_guardian_id uuid, p_student_id uuid, p_request_id text` | VOLATILE | guardian_links | no | BFF, service role: `server/lib/account.ts:246` | prod: **was anon** until hand REVOKE 2026-09-23; fresh rebuild: **anon** | **Yes, until 2026-09-23.** Two profile UUIDs → active guardian link, bypassing consent. Prod fixed by hand; repo fixed by the new migration. | **REVOKE** (migration group 1) |
| `calendar_viewer_is_admin` | — | STABLE | — | yes (auth.uid) | RLS policies (`TO authenticated`) | anon + authenticated | No. STABLE, writes nothing, returns only whether the *caller's own* profile is admin. | **SAFE for authenticated** (RLS helper for two calendar policies); **REVOKE from anon/PUBLIC** (group 3) |
| `capture_mastery_constant_change` | — | VOLATILE (trigger) | mastery_constants_change_log | no | trigger only | anon (PUBLIC), prod and fresh rebuild | No. PostgreSQL refuses a direct call to a trigger function ("trigger functions can only be called as triggers"). | **REVOKE** (group 2, hygiene). The trigger still fires: EXECUTE is checked at CREATE TRIGGER, not at fire time (tested). |
| `handle_new_user` | — | VOLATILE (trigger) | profiles | no | trigger only | anon (PUBLIC), prod and fresh rebuild | No. PostgreSQL refuses a direct call to a trigger function ("trigger functions can only be called as triggers"). | **REVOKE** (group 2, hygiene). The trigger still fires: EXECUTE is checked at CREATE TRIGGER, not at fire time (tested). |
| `sever_crisis_audit_conversation` | — | VOLATILE (trigger) | crisis_review_audit_log | no | trigger only | anon (PUBLIC), prod and fresh rebuild | No. PostgreSQL refuses a direct call to a trigger function ("trigger functions can only be called as triggers"). | **REVOKE** (group 2, hygiene). The trigger still fires: EXECUTE is checked at CREATE TRIGGER, not at fire time (tested). |
| `guardian_can_view_student` | `p_student_id uuid` | STABLE | — | yes (auth.uid) | RLS policies (`TO authenticated`) | authenticated only | No. STABLE, writes nothing, and the principal is `auth.uid()`: it answers "can *I* see this student". | **SAFE**: RLS helper on the 05b/05c guardian read policies; no change |
| `apply_audit_logs_retention` | `p_action text, p_profile_id uuid, p_batch_size integer` | VOLATILE | audit_logs | no | BFF, service role: `server/lib/account-deletion-execute.ts:724` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `apply_mastery_event` | `p_student_id uuid, p_section text, p_domain text, p_skill text, p_difficulty smallint, p_source_family text, p_event_source_kind text, p_correct boolean, p_occurred_at timestamp with time zone, p_event_id uuid, p_question_id text, p_section_state text` | VOLATILE | mastery_event_audit_log, student_skill_mastery | no | BFF, service role: `apps/api/src/services/mastery-write.ts:145` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `apply_notification_delivery_event` | `p_provider_event_id text, p_provider_message_id text, p_event_type text, p_occurred_at timestamp with time zone` | VOLATILE | notification_delivery_events | no | BFF, service role: `server/routes/resend-webhook.ts:174` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `backfill_recompute_student` | `p_student_id uuid, p_t_now timestamp with time zone` | VOLATILE | — | no | SQL-internal (called from other functions) | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `bump_projection_refresh_counter` | `p_student_id uuid, p_section text` | VOLATILE | student_projection_refresh_state | no | SQL-internal (called from other functions) | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `calendar_acknowledge_version` | `p_student_id uuid, p_version_no integer` | VOLATILE | student_study_profile | no | BFF, service role: `server/services/calendar/plan-service.ts:438` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `calendar_do_it_now` | `p_student_id uuid, p_block_id uuid, p_generator_version text, p_idempotency_key uuid` | VOLATILE | calendar_mutation_ledger | no | BFF, service role: `server/services/calendar/plan-service.ts:361` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `calendar_edit_day` | `p_student_id uuid, p_date date, p_members jsonb, p_generator_version text, p_idempotency_key uuid` | VOLATILE | calendar_mutation_ledger | no | BFF, service role: `server/services/calendar/plan-service.ts:329` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `calendar_link_launch` | `p_student_id uuid, p_block_id uuid, p_engine text, p_engine_session_id uuid` | VOLATILE | calendar_block_launches | no | BFF, service role: `server/services/calendar/launch-deps.ts:284` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `calendar_move_block` | `p_student_id uuid, p_block_id uuid, p_to_date date, p_generator_version text, p_idempotency_key uuid` | VOLATILE | calendar_mutation_ledger | no | BFF, service role: `server/services/calendar/plan-service.ts:401` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `calendar_persist_version` | `p_student_id uuid, p_trigger text, p_initiated_by text, p_generator_version text, p_idempotency_key uuid` | VOLATILE | calendar_mutation_ledger | no | BFF, service role: `server/services/calendar/plan-service.ts:266` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `calendar_regenerate_day` | `p_student_id uuid, p_date date, p_trigger text, p_generator_version text, p_idempotency_key uuid` | VOLATILE | calendar_mutation_ledger | no | BFF, service role: `server/services/calendar/plan-service.ts:298` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `cancel_account_deletion` | `p_profile_id uuid` | VOLATILE | account_deletion_requests, audit_logs, deletion_request_log, profiles | no | BFF, service role: `server/routes/account-deletion-routes.ts:150` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `check_and_reserve_practice_quota` | `p_student_user_id uuid, p_account_id uuid, p_session_id uuid, p_session_item_id uuid, p_dry_run boolean, p_request_id text, p_now timestamp with time zone` | VOLATILE | usage_rate_limit_ledger | yes (auth.uid) | BFF, service role: `apps/api/src/lib/rate-limit-ledger.ts:165` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `complete_and_anonymize_account` | `p_request_id uuid, p_profile_id uuid` | VOLATILE | account_deletion_requests | no | BFF, service role: `server/lib/account-deletion-execute.ts:963` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `complete_deletion_log` | `p_completions text` | VOLATILE | audit_logs, deletion_billing_record, deletion_request_log | no | BFF, service role: `server/lib/account-deletion-execute.ts:1088` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `compute_section_projection` | `p_student_id uuid, p_section text, p_t_now timestamp with time zone` | VOLATILE | student_section_projection_snapshots, student_section_projections | no | SQL-internal (called from other functions) | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `deidentify_user` | `target_user_id uuid, deleted_email text` | VOLATILE | profiles | no | BFF, service role: `server/lib/account-deletion-execute.ts:951` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `emit_notification_event` | `p_event_id uuid, p_event_type text, p_subject_profile_id uuid, p_recipients jsonb, p_payload jsonb` | VOLATILE | notification_events, notification_messages | no | SQL-internal (called from other functions) | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `execute_account_deletion_cascade` | `p_profile_id uuid, p_privacy_mode text` | VOLATILE | account_deletion_requests, anonymized_actors, entitlements, guardian_consent_requests, guardian_links, legal_acceptance_outbox, mastery_domain_refresh_audit_log, mastery_event_audit_log, practice_session_items, practice_sessions, profiles, projection_refresh_outbox, review_error_attempts, review_session_items, review_sessions, student_domain_kpi, student_domain_mastery, student_kpi_rollups_current, student_overall_kpi, student_projection_refresh_state, student_section_kpi, student_section_projection_snapshots, student_section_projections, student_skill_kpi, student_skill_mastery, users | no | BFF, service role: `server/lib/account-deletion-execute.ts:174` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `flag_conversation_for_crisis_review` | `p_conversation_id uuid, p_student_id uuid, p_source text, p_signature_id uuid, p_model_confidence numeric, p_category text` | VOLATILE | crisis_review_cases, tutor_conversations | no | BFF, service role: `server/services/tutor-crisis.ts:705` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `guardian_link_audit` | `p_action text, p_actor uuid, p_target uuid, p_changes jsonb, p_link_id uuid, p_request_id text` | VOLATILE | audit_logs | no | SQL-internal (called from other functions) | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `mark_all_notifications_read` | `p_recipient_id uuid` | VOLATILE | notification_messages | no | BFF, service role: `server/routes/notifications.ts:263` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `mark_all_notifications_seen` | `p_recipient_id uuid` | VOLATILE | notification_messages | no | BFF, service role: `server/routes/notifications.ts:230` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `mark_deletion_log_executing` | `p_log_ids uuid[]` | VOLATILE | deletion_consent_evidence, deletion_request_log | no | BFF, service role: `server/lib/account-deletion-execute.ts:850` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `mark_notification` | `p_recipient_id uuid, p_message_id uuid, p_seen boolean, p_read boolean, p_archived boolean` | VOLATILE | notification_messages | no | BFF, service role: `server/routes/notifications.ts:298` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `notification_apply_transition` | `p_message_id uuid, p_event_type text` | VOLATILE | notification_messages | no | SQL-internal (called from other functions) | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `pg_notify_memory_summary` | `p_student_id uuid, p_summary_type text` | VOLATILE | — | no | BFF, service role: `server/services/tutor-compaction.ts:496` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `preclear_account_deletion_links` | `p_profile_id uuid` | VOLATILE | account_deletion_requests, guardian_consent_requests, guardian_links | no | BFF, service role: `server/lib/account-deletion-execute.ts:940` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `recompute_skill_mastery` | `p_student_id uuid, p_section text, p_domain text, p_skill text, p_chain_downstream boolean` | VOLATILE | student_skill_mastery | no | SQL-internal (called from other functions) | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `reconcile_deletion_log` | — | VOLATILE | deletion_request_log | no | BFF, service role: `server/lib/account-deletion-execute.ts:662` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `record_deletion_suppression_outcome` | `p_log_id uuid, p_status text` | VOLATILE | deletion_request_log | no | BFF, service role: `server/lib/account-deletion-execute.ts:527` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `record_deletion_verification` | `p_log_id uuid, p_layers_verified jsonb, p_outcome text, p_deleted_profile_id uuid` | VOLATILE | deletion_verification_records | no | SQL-internal (called from other functions) | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `record_mastery_derivation_gap` | — | VOLATILE | mastery_derivation_gap_ledger | no | SQL-internal (called from other functions) | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `record_notification_send_attempt` | `p_message_id uuid, p_ok boolean, p_provider_message_id text, p_error text, p_max_attempts integer` | VOLATILE | notification_delivery_events, notification_messages | no | BFF, service role: `server/lib/notifications/dispatch.ts:68` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `refresh_domain_kpi` | `p_student_id uuid, p_section text, p_domain text, p_t_now timestamp with time zone` | VOLATILE | student_domain_kpi | no | SQL-internal (called from other functions) | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `refresh_domain_mastery` | `p_student_id uuid, p_section text, p_domain text` | VOLATILE | mastery_domain_refresh_audit_log, student_domain_mastery | no | SQL-internal (called from other functions) | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `refresh_overall_kpi` | `p_student_id uuid, p_t_now timestamp with time zone` | VOLATILE | student_overall_kpi | no | SQL-internal (called from other functions) | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `refresh_section_kpi` | `p_student_id uuid, p_section text, p_t_now timestamp with time zone` | VOLATILE | student_section_kpi | no | SQL-internal (called from other functions) | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `refresh_skill_kpi` | `p_student_id uuid, p_section text, p_domain text, p_t_now timestamp with time zone` | VOLATILE | student_skill_kpi | no | SQL-internal (called from other functions) | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `request_account_deletion` | `p_profile_id uuid, p_actor_id uuid, p_recovery_token_hash text, p_grace_days integer, p_request_channel text` | VOLATILE | account_deletion_requests, audit_logs, deletion_request_log, profiles | no | BFF, service role: `server/routes/account-deletion-routes.ts:191` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `resolve_deletion_billing_record` | `p_log_id uuid, p_final_status text` | VOLATILE | deletion_billing_record | no | BFF, service role: `server/lib/account-deletion-execute.ts:419` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `restore_account_deletion` | `p_recovery_token_hash text` | VOLATILE | account_deletion_requests, audit_logs, deletion_request_log, profiles | no | BFF, service role: `server/routes/account-deletion-routes.ts:109` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `review_queue_graduate` | `p_student_id uuid, p_question_id text, p_review_item_id uuid, p_at timestamp with time zone` | VOLATILE | review_schedule | no | SQL-internal (called from other functions) | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `review_queue_record` | `p_student_id uuid, p_question_id text, p_source_engine text, p_source_session_id uuid, p_source_item_id uuid, p_source_outcome text, p_at timestamp with time zone` | VOLATILE | review_schedule | no | SQL-internal (called from other functions) | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `revoke_guardian_link_audited` | `p_guardian_id uuid, p_student_id uuid, p_revoked_by uuid, p_reason text, p_request_id text` | VOLATILE | guardian_links | no | BFF, service role: `server/lib/account.ts:271` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `rewrite_anonymized_actors` | — | VOLATILE | anonymized_actors | no | BFF, service role: `server/lib/account-deletion-execute.ts:755` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `sweep_deletion_evidence` | `p_batch_size integer` | VOLATILE | deletion_consent_evidence, deletion_request_log | no | BFF, service role: `server/lib/account-deletion-execute.ts:690` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `sweep_financial_record_retention` | `p_batch_size integer` | VOLATILE | — | no | BFF, service role: `server/lib/retention/sweeps.ts:141` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `sweep_notification_retention` | `p_batch_size integer` | VOLATILE | notification_delivery_events, notification_events | no | BFF, service role: `server/lib/notifications/retention.ts:51` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `sweep_operational_log_retention` | `p_batch_size integer` | VOLATILE | — | no | BFF, service role: `server/lib/retention/sweeps.ts:129` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `calendar_build_plan_input` | `p_student_id uuid, p_dates date[]` | STABLE | — | no | SQL-internal (called from other functions) | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `calendar_weekly_candidates` | `p_limit integer` | STABLE | — | no | BFF, service role: `server/services/calendar/weekly-job.ts:153` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `canonical_mastery_events` | `p_student_id uuid, p_entity_type text, p_section text, p_domain text, p_skill text` | STABLE | — | no | SQL-internal (called from other functions) | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `canonical_mastery_events_for_student` | `p_student_id uuid` | STABLE | — | no | SQL-internal (called from other functions) | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `canonicalize_active_mastery_constants_state` | — | STABLE | — | no | SQL-internal (called from other functions) | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `canonicalize_mastery_constants` | — | STABLE | — | no | SQL-internal (called from other functions) | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `canonicalize_mastery_constants_serialized` | — | STABLE | — | no | SQL-internal (called from other functions) | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `canonicalize_projection_constants_serialized` | — | STABLE | — | no | SQL-internal (called from other functions) | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `compute_longest_streak_days` | `p_student_id uuid, p_t_now timestamp with time zone` | STABLE | — | no | SQL-internal (called from other functions) | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `compute_mastery_for_entity` | `p_student_id uuid, p_entity_type text, p_section text, p_domain text, p_skill text` | STABLE | — | no | SQL-internal (called from other functions) | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `compute_streak_days` | `p_student_id uuid, p_section text, p_domain text, p_skill text, p_t_now timestamp with time zone` | STABLE | — | no | SQL-internal (called from other functions) | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `entitlement_active` | `p_profile_id uuid` | STABLE | — | no | BFF, service role: `server/services/entitlement-service.ts:90` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `guardian_can_view_student_as` | `p_guardian_id uuid, p_student_id uuid` | STABLE | — | no | SQL-internal (called from other functions) | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `guardian_view_decision` | `p_guardian_id uuid, p_student_id uuid` | STABLE | — | no | BFF, service role: `server/services/guardian-subject.ts:46` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `mastery_min_events` | — | STABLE | — | no | SQL-internal (called from other functions) | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `mastery_model_version` | — | STABLE | — | no | BFF, service role: `packages/shared/src/rule4-columns.ts:36` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `notification_feed` | `p_recipient_id uuid, p_limit integer, p_before_message_id uuid, p_archived boolean` | STABLE | — | no | BFF, service role: `server/routes/notifications.ts:117` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `notification_unread_count` | `p_recipient_id uuid` | STABLE | — | no | BFF, service role: `server/routes/notifications.ts:201` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `read_kpi_recency_constants` | `OUT short_days integer, OUT long_days integer` | STABLE | — | no | SQL-internal (called from other functions) | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `read_projection_constants` | `OUT target_qcount integer, OUT min_delta numeric, OUT max_delta numeric, OUT mid_round integer, OUT bound_round integer, OUT section_max integer, OUT section_min integer, OUT weights jsonb` | STABLE | — | no | SQL-internal (called from other functions) | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `student_diagnostic_state` | `p_student_id uuid` | STABLE | — | no | BFF, service role: `server/services/canonical-runtime-views.ts:751` | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `practice_item_enqueue_review` | — | VOLATILE (trigger) | — | no | trigger only | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `review_item_resolve` | — | VOLATILE (trigger) | review_error_attempts | no | trigger only | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `sync_tutor_conversations_on_entitlement_change` | — | VOLATILE (trigger) | tutor_conversations | no | trigger only | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |
| `validate_memory_summary_schema` | — | VOLATILE (trigger) | — | no | trigger only | no; service_role only | No. Neither anon nor authenticated can EXECUTE it. | REVOKE already in effect (explicit in repo, matches prod) |

**Totals:**

| Verdict | Count | Functions |
|---|---|---|
| REVOKE, new | 5 | `create_active_guardian_link_audited`; 3 trigger functions; `calendar_viewer_is_admin` (from anon only) |
| SAFE for `authenticated` | 2 | `calendar_viewer_is_admin`, `guardian_can_view_student` |
| REVOKE already in effect | 76 | everything else |

`calendar_viewer_is_admin` appears in two rows: it is revoked from anon but stays SAFE for `authenticated`. **GUARD:** none. No legitimate caller uses the anon or authenticated key, so no function needs a caller check added instead of a REVOKE.

**Not in scope, reported:**
- **13 non-`SECURITY DEFINER` functions in `public` are also executable by anon** (e.g. `rate_limit_check_and_increment`, `select_practice_pool_random`).
  - They run as the caller, so RLS and table grants apply.
  - `anon` holds SELECT on exactly two tables (`difficulties`, `sections`) and nothing else. None of them can read or write data as anon.
  - `select_practice_pool_random` returns `correct_answer`; its safety rests entirely on anon having no grant on `questions`. That is worth an explicit REVOKE in a follow-up, but it is not an exposure today.
- **`supabase_functions` holds one platform-owned SECURITY DEFINER function** executable by anon. It is Supabase's, not ours.

## A.2 — How it happened: a convention, not a template

There is no helper or copied block that creates `SECURITY DEFINER` without a REVOKE. The opposite is true:
- The convention is an explicit `REVOKE ALL ON FUNCTION … FROM PUBLIC` beside each definition; `supabase/migrations` contains 104 of them.
- **The failure mode is that the convention is manual, and nothing checked it.**
- Five functions were missed across four migrations:

| Function | Migration | How PUBLIC got in |
|---|---|---|
| `create_active_guardian_link_audited` | `20260901000000_scl_080_guardian_link_code.sql`, redefined in `20260903000000_notifications_rebuild.sql` | Neither file revokes it; the ACL is left at the PostgreSQL default (EXECUTE to PUBLIC) |
| `sever_crisis_audit_conversation` | `20260918000000_crisis_severance_and_verification.sql` | Same: no ACL statement at all |
| `handle_new_user`, `capture_mastery_constant_change` | `20260619000000_handle_new_user_trigger.sql`, `20260624020000_05d_governance_substrate.sql` | Never revoked. The ACL shows `=X` because `20260827000000_explicit_service_role_grants.sql` granted service_role, and PostgreSQL writes the implicit PUBLIC default into the ACL the first time any grant is made |
| `calendar_viewer_is_admin` | `20260917130000_calendar_v1.sql` | Granted to `authenticated` as intended; the implicit PUBLIC default was never revoked, so it too materialized as `=X` |

**On whether anything explicitly grants PUBLIC:**
- No migration contains `GRANT EXECUTE … TO PUBLIC`.
- Every PUBLIC entry comes from PostgreSQL's create-time default: EXECUTE to PUBLIC on every new function.
- Production also carries `ALTER DEFAULT PRIVILEGES` on `public` for role `postgres`: `{postgres=X, service_role=X}`, with no PUBLIC. It is recorded in `20260827000000_explicit_service_role_grants.sql`.
- **That default is not in the repo**, and a fresh database does not have it. The gate therefore runs against a fresh apply, where no platform default can hide a missing REVOKE.

## A.3 — Deliverables (neither applied)

- **Migration `20261001000000_security_definer_revoke_public.sql`**
  - Three groups, each applicable as one statement block. Idempotent.
  - Every REVOKE names its caller or states there is none.
  - It also contains B.2 (below).
- **CI gate A.6** in `scripts/ci/genesis-fresh-apply.sh`, running `scripts/ci/secdef-exposure.sql`. It fails when any `public` SECURITY DEFINER function is:
  - executable by `anon`; or
  - executable by `authenticated` without `auth.uid()` / `auth.jwt()` / `auth.role()` in its body.

  It self-tests first: a throwaway unrevoked SECURITY DEFINER function, created in a rolled-back transaction, must be flagged. Evidence:
  - **Without the migration** it fails and names exactly the five functions above.
  - **With the migration** it passes.
  - The committed schema snapshot changes only by the 20 ACL lines the migration adds.
  - Runs in the existing `genesis-fresh-apply` job, so no workflow change is needed.

**Why trigger functions are revoked.** PostgreSQL checks EXECUTE on a trigger function at `CREATE TRIGGER` time, never when the trigger fires. This was tested on 2026-09-23:
- After `REVOKE ALL … FROM PUBLIC`, an unprivileged role's INSERT still fired the trigger.
- A direct call was denied.

So `handle_new_user` keeps working for `auth.users` inserts.

## B.2 — Guardian REVOKE migration

Folded into group 1 of the migration above. It is the same statement Karl ran by hand, plus `anon` and `authenticated` named explicitly. Folded rather than kept separate because the gate would fail on a branch that fixed four of the five.

## B.3 — Has any Terraform in this repo ever been applied?

**Not provable from the repo or from any access this session has.**
- State lives in `gs://lyceon-terraform-state/lyceon-lisa` (`infra/terraform/main.tf`). No CI job runs Terraform; the README says "Karl runs everything".
- The only GCP identity in CI, `lyceon-ci-eval@`, runs `gcloud auth list` and nothing else.

**Circumstantial evidence of at least a partial apply:**
- `cloud-tasks.tf` records "Verified by Karl via `gcloud tasks queues describe lisa-crisis-notification`" and a retry policy Karl tightened. That queue was **imported**, not created.
- The worker's in-code note reports Google returning `TEMPLATE_NOT_FOUND` for Model Armor. Something was queried, but it was at `locations/global`, not where Terraform puts the templates.

**What would settle it:**

```bash
gcloud storage ls gs://lyceon-terraform-state/lyceon-lisa/        # state file exists at all?
terraform -chdir=infra/terraform state list                     # what Terraform believes it manages
gcloud scheduler jobs list --location us-central1               # lyceon-retention-sweep-{7d,90d,180d} present?
gcloud iam service-accounts describe lisa-cloud-tasks@replit-cop.iam.gserviceaccount.com
gcloud model-armor templates list --location us-central1
```

**Why it matters:** the retention sweep jobs are the cleanest test, because they are Terraform-**created** (not imported). If they are absent, then:
- PR 2's SLA-sweep job and PR 3's compaction queue are **declarations, not deployments**, until Karl runs `terraform apply`;
- the 7d/90d/180d retention sweeps have never run either.

## B.4 — The eight-state walkthrough: what Karl must provide

1. **Access to the preview.** The Vercel project has SSO protection on `all_except_custom_domains` (read 2026-09-23), so every `*.vercel.app` preview requires a Vercel login. Karl provides either:
   - a **Protection Bypass for Automation** secret (Project → Settings → Deployment Protection), sent as `x-vercel-protection-bypass`; or
   - a preview alias on a custom domain.
2. **A test student.** Supabase email and password for a `student` profile with `is_under_13 = false` and an **active entitlement** (`entitlement_active(id) = true`), on whichever Supabase project the Preview environment points at.
3. **Confirmation of which Supabase the preview uses.** If Preview env vars point at production, the walkthrough writes real rows and pages real ops.
4. **Crisis-state permission.** Two of the eight states (crisis support card, paused bar) require sending a crisis message, which pages Slack. Either set `LYCEON_CRISIS_ALERTS` on Preview to a test channel, or agree in advance that the alerts are expected.
5. **Preview env parity.** `TUTOR_ORCHESTRATOR_WORKER_URL` and `GCP_SERVICE_ACCOUNT_JSON` must be set for the **Preview** environment. Otherwise every turn returns 503 and the normal-response states cannot be reached.

## B.5 — Spec debt

Drafted as SCL-119 and SCL-120 in `docs/SpecAudit/SPEC_CHANGES_LOG.md` on PR 1's branch (#845), the change that relies on them. No locked spec document was touched.
