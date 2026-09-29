-- ===========================================================================
-- F2 — the published retention periods, seeded into the table that owns them
-- ===========================================================================
-- @spec [Doc-01A App A.5 (`observability_runtime_config` keys and owners);
--        Doc-01_V8 §5.1 ("Retention values live in `observability_runtime_config`
--        per Doc 01A §74"); Privacy Policy v4 §6.5 and §6.7; SCL-101 items (ii)
--        and (iii); owner rulings 2026-09-22 F2 and "published policy is the
--        canonical owner of retention periods"]
--        | @implemented [2026-09-22]
--
-- plain English: Doc 01 §5.1 says retention values live in
-- `observability_runtime_config`. The table has existed since genesis holding
-- nothing. This seeds the two Legal-owned retention keys whose period the
-- published Privacy Policy actually states AND whose enforcement actually
-- exists, and deliberately leaves the third unseeded.
--
-- NOTHING READS THIS TABLE, AND THAT IS ON THE RECORD. Per the owner ruling,
-- F2 seeds it anyway so the declared value and the enforced value can be
-- compared. That comparison is the only thing keeping these rows honest, so it
-- is a test, not a comment: `tests/ci/observability-retention-config.pg.ci.test.ts`
-- asserts each seeded value equals what the enforcing function returns. A
-- config row nobody reads and nobody checks is a number that drifts from
-- behaviour without anyone noticing — which is the failure this whole
-- workstream keeps finding.
--
-- WHY THE VALUES ARE COMPUTED, NOT TYPED. Each value is `to_jsonb(<the
-- function that enforces it>)` rather than a literal. The period is still
-- defined exactly once, in the function; this row is a projection of it. Typing
-- `365` here would create a second place the number lives, and the two would
-- disagree the first time one changed. "Never fork a second version" applies to
-- constants as much as to helpers.
--
-- WHY `audit_retention_by_category` HOLDS ONE CATEGORY, NOT FOUR. Doc 01A A.5
-- points this key at Doc 01 V8 §5.1, which sets four tiers (90d / 365d / 7-year
-- / permanent) by audit event category. SCL-101 item (ii) already recorded that
-- the build has ONE audit window — `audit_logs_retention_days()`, applied
-- uniformly — and that the published policy publishes 365 days "because that is
-- what runs". Seeding four tiers would put three periods into the config that
-- no code enforces and no policy publishes. The object carries the one category
-- v4 §6.5 actually names.
--
-- WHY `cold_log_retention_days` IS NOT SEEDED AT ALL. Doc 01A A.5 gives it a
-- launch value of 365 and describes it as "cold archive retention before
-- purge". There is no cold archive: SCL-101 item (iii) records that
-- `audit_logs_archive` is referenced across the corpus and the table does not
-- exist, and v4 makes no claim that expired security records move anywhere.
-- Seeding 365 would declare an archive tier that does not exist — which is
-- exactly what the BigQuery archive was, and what the ruling of the same day
-- removed. It stays unseeded until something archives.
--
-- `log_level_default` and `alert_thresholds` are also unseeded. Neither is a
-- retention period, so neither is in this ruling's scope; `alert_thresholds`
-- additionally needs `infra/alert-registry.yaml`, which does not exist and is
-- constrained by Doc 07 Parent INV-07-09 ("No Doc 07 V1 mechanism produces an
-- alert").
--
-- trade-offs: the seed is a point-in-time projection. If someone changes
-- `audit_logs_retention_days()` later, this row goes stale until re-seeded —
-- the PG suite turns that staleness into a failing test rather than a silent
-- divergence, which is the best available answer while nothing reads the table.
--
-- edge cases: ON CONFLICT DO NOTHING, so re-applying is safe and an
-- operator-set value is never overwritten by a migration replay.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
-- Apply order: after 20260917100000 (which defines `audit_logs_retention_days`)
-- and 20260921000000 (which defines `operational_log_retention_days`). Both are
-- already applied; this file reads them at INSERT time and fails loudly if
-- either is missing rather than seeding a wrong number.
-- ===========================================================================

BEGIN;

INSERT INTO public.observability_runtime_config
  (key, value, value_type, min_value, max_value, owner, description, environment)
VALUES
  (
    'audit_retention_by_category',
    jsonb_build_object(
      'security_and_administrative',
      to_jsonb(public.audit_logs_retention_days())
    ),
    'object', NULL, NULL, 'Legal',
    'Retention per audit event category, in days. Privacy Policy v4 §6.5 publishes ONE period for this whole class — sign-ins, security events and administrative actions, 365 days — and the build enforces one window, public.audit_logs_retention_days(). Doc 01 V8 §5.1''s four tiers are neither published nor built; see SCL-101 (ii). Declarative: nothing reads this row.',
    'all'
  ),
  (
    'hot_log_retention_days',
    to_jsonb(public.operational_log_retention_days()),
    'integer', '30'::jsonb, '365'::jsonb, 'Legal',
    'Ceiling on operational records not covered by an enumerated category, in days. Privacy Policy v4 §6.7 publishes 90; public.sweep_operational_log_retention enforces it against four tables. Declarative: nothing reads this row.',
    'all'
  )
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE public.observability_runtime_config IS
  'Doc 01A App A.5. Holds the two Legal-owned retention periods the published Privacy Policy states and the build enforces (SCL-101). NO CODE READS THIS TABLE: the rows are declarative, and tests/ci/observability-retention-config.pg.ci.test.ts holds each one to the function that actually enforces it. cold_log_retention_days is deliberately absent — no cold archive exists (SCL-101 (iii)).';

COMMIT;
