-- ============================================================================
-- Guardian link, first write in production: is the link RECORDED?
--
-- @spec [Doc-01_V8 §35 audit trail; owner ruling 2026-08-27 Q5 (fail-closed);
--        migration 20260828000000_guardian_link_audited_transitions.sql]
--
-- WHEN TO RUN. The first time a guardian link is created in production, and any time after.
-- READ-ONLY: every statement is a SELECT. Safe on prod, safe to re-run.
--
-- WHAT IT ANSWERS, in one line: the first `guardian_links` row and the first `audit_logs`
-- row appear together, or neither does. Before this migration those were two PostgREST calls
-- in two transactions, so a link could exist unrecorded; now each transition and its audit row
-- share one transaction, and this is the check that says so against real data.
--
-- Baseline at authoring time (advisor-verified 2026-08-27): guardian_links 0 rows,
-- audit_logs 0 rows. So "neither does" is the expected answer until the first link is made.
--
-- HOW TO READ IT. Paste the whole file into the Supabase SQL editor. The console commonly
-- shows only the LAST result grid, so section 7 is a single-row rollup carrying the go/no-go
-- in a `verdict` column — read that first. Sections 1-6 are the evidence behind it and each
-- one names itself in a `check` column, so a scrolled-back grid is still self-describing.
--
-- NO psql META-COMMANDS. An earlier draft of this file used `\echo` for its section headers
-- and would have failed in the console at the first one with `42601 syntax error at or near
-- "\"` — not partially, not with the headers missing: it would not have run at all. The
-- headers are columns now. `scripts/ci/prod-verify-console-gate.sh` is what caught it, by
-- executing this file the way an operator does rather than the way CI finds convenient.
-- ============================================================================

-- === 1. Counts. Both zero, or both non-zero — never one of each. ===
SELECT
  '1. counts'                                                                   AS check,
  (SELECT count(*) FROM public.guardian_links)                                  AS links_total,
  (SELECT count(*) FROM public.audit_logs
     WHERE action LIKE 'guardian_link_%')                                       AS link_audits_total,
  (SELECT count(*) FROM public.audit_logs
     WHERE action IN ('guardian_link_initiated','guardian_link_accepted','guardian_link_revoked'))
                                                                                AS transition_audits;

-- === 2. Any row here is a link that exists without a creation record. ===
--     Expected: zero rows. A row means fail-closed did not hold.
SELECT '2. link-without-creation-audit' AS check,
       gl.id AS link_id, gl.status, gl.initiated_at
  FROM public.guardian_links gl
 WHERE NOT EXISTS (
   SELECT 1 FROM public.audit_logs a
    WHERE a.action = 'guardian_link_initiated'
      AND a.context->>'link_id' = gl.id::text
 )
 ORDER BY gl.initiated_at;

-- === 3. Same question for the other two transitions. Expected: zero rows each. ===
SELECT '3. accepted-without-audit' AS check, gl.id AS link_id, gl.accepted_at AS at
  FROM public.guardian_links gl
 WHERE gl.accepted_at IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.audit_logs a
      WHERE a.action = 'guardian_link_accepted'
        AND a.context->>'link_id' = gl.id::text)
UNION ALL
SELECT '3. revoked-without-audit', gl.id, gl.revoked_at
  FROM public.guardian_links gl
 WHERE gl.revoked_at IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.audit_logs a
      WHERE a.action = 'guardian_link_revoked'
        AND a.context->>'link_id' = gl.id::text);

-- === 4. The reverse gap: an audit row naming a link that does not exist. ===
--     Expected: zero rows. audit_logs is append-only, so a revoked link still exists;
--     a missing one would mean a hard delete nothing in this design performs.
SELECT '4. audit-without-link' AS check,
       a.id AS audit_id, a.action, a.context->>'link_id' AS link_id
  FROM public.audit_logs a
 WHERE a.action IN ('guardian_link_initiated','guardian_link_accepted','guardian_link_revoked')
   AND a.context->>'link_id' IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.guardian_links gl
      WHERE gl.id::text = a.context->>'link_id');

-- === 5. The transition functions are present and service-role only. ===
--     Expected: 4 rows, every one prosecdef = t, and acl granting EXECUTE to service_role.
SELECT '5. functions' AS check,
       p.proname,
       p.prosecdef,
       pg_catalog.array_to_string(p.proacl, ' | ') AS acl
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('guardian_link_audit',
                     'create_guardian_link_audited',
                     'accept_guardian_link_audited',
                     'revoke_guardian_link_audited')
 ORDER BY p.proname;

-- === 6. The append-only trigger is still on audit_logs. ===
--     Expected: 1 row (audit_logs_no_mutate). Without it the trail is editable and
--     everything above becomes a statement about the present only.
SELECT '6. append-only trigger' AS check, tgname
  FROM pg_trigger
 WHERE tgrelid = 'public.audit_logs'::regclass
   AND NOT tgisinternal;

-- === 7. THE VERDICT — the rollup a console showing only the last grid must be able to act on.
--     PASS requires all four gaps empty AND the four functions present, SECURITY DEFINER,
--     AND the append-only trigger in place. A missing function is not a "no data yet" state:
--     it means the migration has not been applied and every count above is answering a
--     question about a mechanism that does not exist.
WITH gaps AS (
  SELECT
    (SELECT count(*) FROM public.guardian_links gl
      WHERE NOT EXISTS (SELECT 1 FROM public.audit_logs a
                         WHERE a.action = 'guardian_link_initiated'
                           AND a.context->>'link_id' = gl.id::text))            AS created_gap,
    (SELECT count(*) FROM public.guardian_links gl
      WHERE gl.accepted_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.audit_logs a
                         WHERE a.action = 'guardian_link_accepted'
                           AND a.context->>'link_id' = gl.id::text))            AS accepted_gap,
    (SELECT count(*) FROM public.guardian_links gl
      WHERE gl.revoked_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.audit_logs a
                         WHERE a.action = 'guardian_link_revoked'
                           AND a.context->>'link_id' = gl.id::text))            AS revoked_gap,
    (SELECT count(*) FROM public.audit_logs a
      WHERE a.action IN ('guardian_link_initiated','guardian_link_accepted','guardian_link_revoked')
        AND a.context->>'link_id' IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.guardian_links gl
                         WHERE gl.id::text = a.context->>'link_id'))            AS orphan_audit_gap,
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prosecdef
        AND p.proname IN ('guardian_link_audit',
                          'create_guardian_link_audited',
                          'accept_guardian_link_audited',
                          'revoke_guardian_link_audited'))                      AS definer_fns,
    (SELECT count(*) FROM pg_trigger
      WHERE tgrelid = 'public.audit_logs'::regclass AND NOT tgisinternal
        AND tgname = 'audit_logs_no_mutate')                                    AS append_only,
    (SELECT count(*) FROM public.guardian_links)                                AS links_total
)
SELECT
  CASE
    WHEN definer_fns < 4 THEN
      'FAIL — migration 20260828000000 is not applied: only ' || definer_fns ||
      ' of 4 SECURITY DEFINER transition functions exist'
    WHEN append_only < 1 THEN
      'FAIL — audit_logs_no_mutate trigger is missing: the trail is editable'
    WHEN created_gap + accepted_gap + revoked_gap + orphan_audit_gap > 0 THEN
      'FAIL — ' || (created_gap + accepted_gap + revoked_gap + orphan_audit_gap) ||
      ' link/audit gap(s); see sections 2-4'
    WHEN links_total = 0 THEN
      'PASS (vacuous) — mechanism is in place; no guardian_links rows exist yet, so nothing ' ||
      'has been exercised. Re-run after the first link.'
    ELSE
      'PASS — ' || links_total || ' link(s), every transition carries its audit row'
  END                                                                           AS verdict,
  created_gap, accepted_gap, revoked_gap, orphan_audit_gap, definer_fns, append_only, links_total
  FROM gaps;
