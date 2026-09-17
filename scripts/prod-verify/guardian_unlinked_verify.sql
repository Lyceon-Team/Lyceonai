-- ===========================================================================
-- GUARDIAN_UNLINKED — POST-APPLY VERIFY (after 20260915000000_guardian_unlinked_event.sql)
-- ===========================================================================
-- READ-ONLY against application data. Paste into the Supabase SQL editor and run.
-- The only objects this file creates live in pg_temp and vanish with the session.
--
-- @spec [contracts/notifications.contract.md C1.1 (CHECK lists guardian_linked AND
--        guardian_unlinked), C2.2 (the emit lives inside revoke_guardian_link_audited),
--        C2.3 (recipient = v_target only), C8.1 (payload never carries revocation_reason);
--        Doc-01_V8 §36.3, §12.1]
-- @implemented [2026-09-15]
--
-- plain English: one row per assertion, expected value INLINE, observed value read from the
-- catalog, PASS/FAIL per row, overall verdict last. Supersedes row "CHECK is guardian_linked
-- only" in notifications_rebuild_verify.sql, which described the state BEFORE this migration.
--
-- THE NEGATIVE CONTROL (rows 6–7). The load-bearing assertion is that the function body
-- emits the event and does NOT put p_reason into the payload. A text check that is never
-- seen failing proves nothing, so rows 6–7 run the SAME pg_temp predicate against a
-- deliberately wrong body (one that interpolates p_reason into the payload) and must report
-- FAIL for it. If either control row fails, the verdict is STOP regardless of rows 1–5.
-- ===========================================================================

-- The one predicate every "reason absent from payload" row goes through.
CREATE FUNCTION pg_temp.gu_reason_absent_from_emit(p_body text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $gu$
  SELECT position('emit_notification_event' IN p_body) > 0
     AND position('p_reason' IN substring(p_body FROM position('emit_notification_event' IN p_body))) = 0;
$gu$;

WITH fn AS (
  SELECT pg_get_functiondef(p.oid) AS body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'revoke_guardian_link_audited'
),
chk AS (
  SELECT pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public' AND t.relname = 'notification_events'
     AND c.conname = 'notification_events_type_check'
),
rows AS (
  SELECT 1 AS n, 'CHECK admits guardian_unlinked' AS assertion,
         'contains guardian_unlinked' AS expected,
         coalesce((SELECT def FROM chk), '<missing>') AS observed,
         (SELECT def FROM chk) LIKE '%guardian_unlinked%' AS pass
  UNION ALL
  SELECT 2, 'CHECK still admits guardian_linked',
         'contains guardian_linked',
         coalesce((SELECT def FROM chk), '<missing>'),
         (SELECT def FROM chk) LIKE '%guardian_linked%'
  UNION ALL
  SELECT 3, 'revoke_guardian_link_audited emits guardian_unlinked (C2.2)',
         'body calls emit_notification_event with guardian_unlinked',
         CASE WHEN (SELECT body FROM fn) LIKE '%emit_notification_event%'
               AND (SELECT body FROM fn) LIKE '%''guardian_unlinked''%'
              THEN 'emit present' ELSE 'emit ABSENT' END,
         (SELECT body FROM fn) LIKE '%emit_notification_event%'
           AND (SELECT body FROM fn) LIKE '%''guardian_unlinked''%'
  UNION ALL
  SELECT 4, 'recipient is v_target only (C2.3 — one derivation)',
         'emit recipients built from v_target; no second CASE after the audit call',
         CASE WHEN (SELECT body FROM fn) LIKE '%''profile_id'', v_target%' THEN 'v_target' ELSE 'NOT v_target' END,
         (SELECT body FROM fn) LIKE '%''profile_id'', v_target%'
  UNION ALL
  SELECT 5, 'revocation_reason never enters the payload (C8.1, §12.1)',
         'p_reason absent after the emit call',
         CASE WHEN pg_temp.gu_reason_absent_from_emit((SELECT body FROM fn)) THEN 'absent' ELSE 'PRESENT' END,
         pg_temp.gu_reason_absent_from_emit((SELECT body FROM fn))
  UNION ALL
  -- Negative control: a body that DOES leak the reason must FAIL the same predicate.
  SELECT 6, 'CONTROL: predicate fails a body that leaks p_reason into the payload',
         'false',
         pg_temp.gu_reason_absent_from_emit(
           'PERFORM public.emit_notification_event(x, ''guardian_unlinked'', y, r, jsonb_build_object(''reason'', p_reason));'
         )::text,
         NOT pg_temp.gu_reason_absent_from_emit(
           'PERFORM public.emit_notification_event(x, ''guardian_unlinked'', y, r, jsonb_build_object(''reason'', p_reason));'
         )
  UNION ALL
  -- Negative control: a body with NO emit at all must also FAIL (an absent emit is not "reason absent").
  SELECT 7, 'CONTROL: predicate fails a body with no emit call',
         'false',
         pg_temp.gu_reason_absent_from_emit('UPDATE public.guardian_links SET status = ''revoked'';')::text,
         NOT pg_temp.gu_reason_absent_from_emit('UPDATE public.guardian_links SET status = ''revoked'';')
)
SELECT n, assertion, expected, observed,
       CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS verdict
  FROM rows
UNION ALL
SELECT 99, 'OVERALL', 'all rows PASS',
       (SELECT count(*) FILTER (WHERE NOT pass)::text || ' failing row(s)' FROM rows),
       CASE WHEN (SELECT bool_and(pass) FROM rows)
            THEN 'OK: guardian_unlinked landed as written (CHECK widened, emit inside the revoke RPC, v_target only, reason never in payload, controls behaved)'
            ELSE 'STOP: at least one row failed — do not proceed' END
 ORDER BY n;
