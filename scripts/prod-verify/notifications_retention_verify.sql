-- ===========================================================================
-- NOTIFICATIONS RETENTION — POST-APPLY VERIFY
-- (after 20260915100000_notification_retention_sweep_and_feed_archive.sql AND
--  20260916100000_notification_retention_sweep_orphaned_delivery_events.sql)
-- ===========================================================================
-- READ-ONLY. Paste into the Supabase SQL editor and run. Nothing here writes: the sweep is
-- NOT invoked; only catalog facts and the window constant are read.
--
-- @spec [contracts/notifications.contract.md C11.1 (window = 90, defined once), C11.2 (the
--        sweep: SECURITY DEFINER, pinned search_path, reads the window function, no literal
--        window), C3.1 (feed carries p_archived and archived_at), C3.2 (mark-all-read)]
-- @implemented [2026-09-15]
--
-- plain English: one row per assertion, expected inline, OVERALL last. Rows 1–8 are the
-- objects the first migration creates or replaces; rows 9–11 are the orphan branch added by
-- 20260916100000 (same function, same cutoff, both counts). Rows 12–13 are the negative control: the same
-- "no literal window in the body" test is run against a temp function that DOES carry the
-- literal, and must read FAIL there — a check that cannot tell the two apart reads STOP on
-- its own control.
-- ===========================================================================

CREATE FUNCTION pg_temp.window_literal_present(p_body text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE WHEN p_body ~ '(interval\s*''90|=>\s*90\b|90 days)' THEN 'literal present' ELSE 'no literal' END
$f$;

CREATE FUNCTION pg_temp.control_with_literal() RETURNS integer LANGUAGE sql IMMUTABLE AS $f$
  SELECT extract(day from interval '90 days')::integer
$f$;

WITH fn AS (
  SELECT p.proname,
         pg_get_function_identity_arguments(p.oid) AS args,
         pg_get_functiondef(p.oid)                  AS def,
         p.prosecdef                                AS secdef,
         coalesce(array_to_string(p.proconfig, ','), '') AS config
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('notification_retention_days', 'sweep_notification_retention',
                       'notification_feed', 'mark_all_notifications_read')
),
a(seq, assertion, expected, observed) AS (
  VALUES
  ( 1, 'notification_retention_days() exists and returns 90',
       '90',
       coalesce((SELECT public.notification_retention_days()::text), 'MISSING')),
  ( 2, 'sweep_notification_retention(integer) exists',
       'present',
       coalesce((SELECT 'present' FROM fn WHERE proname = 'sweep_notification_retention' AND args = 'p_batch_size integer'), 'MISSING')),
  ( 3, 'sweep is SECURITY DEFINER with search_path pinned to public, pg_temp',
       'definer + pinned',
       coalesce((SELECT CASE WHEN secdef AND config LIKE 'search_path=public, pg_temp%' THEN 'definer + pinned'
                             WHEN secdef THEN 'definer, NOT pinned' ELSE 'NOT definer' END
                   FROM fn WHERE proname = 'sweep_notification_retention'), 'MISSING')),
  ( 4, 'sweep body reads the window from notification_retention_days()',
       'reads function',
       coalesce((SELECT CASE WHEN position('public.notification_retention_days()' IN def) > 0 THEN 'reads function' ELSE 'does not' END
                   FROM fn WHERE proname = 'sweep_notification_retention'), 'MISSING')),
  ( 5, 'sweep body carries NO literal window (the window is defined once)',
       'no literal',
       coalesce((SELECT pg_temp.window_literal_present(def) FROM fn WHERE proname = 'sweep_notification_retention'), 'MISSING')),
  ( 6, 'notification_feed has exactly ONE overload and it carries p_archived',
       'one overload, p_archived',
       (SELECT CASE WHEN count(*) = 1 AND bool_and(args LIKE '%p_archived boolean%') THEN 'one overload, p_archived'
                    WHEN count(*) = 0 THEN 'MISSING'
                    ELSE count(*)::text || ' overloads' END
          FROM fn WHERE proname = 'notification_feed')),
  ( 7, 'notification_feed returns archived_at',
       'present',
       coalesce((SELECT CASE WHEN position('archived_at' IN def) > 0 THEN 'present' ELSE 'absent' END
                   FROM fn WHERE proname = 'notification_feed'), 'MISSING')),
  ( 8, 'mark_all_notifications_read(uuid) exists as SECURITY DEFINER',
       'present',
       coalesce((SELECT CASE WHEN secdef THEN 'present' ELSE 'NOT definer' END
                   FROM fn WHERE proname = 'mark_all_notifications_read' AND args = 'p_recipient_id uuid'), 'MISSING')),
  ( 9, 'sweep has the orphan branch: deletes notification_delivery_events WHERE message_id IS NULL on received_at',
       'present',
       coalesce((SELECT CASE WHEN position('DELETE FROM public.notification_delivery_events' IN def) > 0
                              AND position('message_id IS NULL' IN def) > 0
                              AND position('received_at < v_cutoff' IN def) > 0
                             THEN 'present' ELSE 'absent' END
                   FROM fn WHERE proname = 'sweep_notification_retention'), 'MISSING')),
  (10, 'sweep derives the cutoff exactly ONCE (one window read for both branches)',
       '1',
       coalesce((SELECT ((length(def) - length(replace(def, 'public.notification_retention_days()', ''))) / length('public.notification_retention_days()'))::text
                   FROM fn WHERE proname = 'sweep_notification_retention'), 'MISSING')),
  (11, 'sweep returns deleted_orphan_delivery_events',
       'present',
       coalesce((SELECT CASE WHEN position('deleted_orphan_delivery_events' IN def) > 0 THEN 'present' ELSE 'absent' END
                   FROM fn WHERE proname = 'sweep_notification_retention'), 'MISSING')),
  -- Negative control: the literal detector must FIRE on a body that carries the literal.
  (12, 'CONTROL: literal detector fires on a body carrying interval ''90 days''',
       'literal present',
       pg_temp.window_literal_present(pg_get_functiondef('pg_temp.control_with_literal()'::regprocedure))),
  (13, 'CONTROL: the control function is not what row 5 tested (different body)',
       'different',
       CASE WHEN (SELECT def FROM fn WHERE proname = 'sweep_notification_retention')
                 = pg_get_functiondef('pg_temp.control_with_literal()'::regprocedure)
            THEN 'SAME BODY' ELSE 'different' END)
)
SELECT seq, assertion, expected, observed, verdict
FROM (
  SELECT seq, assertion, expected, observed,
         CASE WHEN observed = expected THEN 'PASS' ELSE 'FAIL' END AS verdict
  FROM a
  UNION ALL
  SELECT 99, 'OVERALL', 'every row PASS',
         count(*) FILTER (WHERE observed <> expected)::text || ' FAIL of ' || count(*)::text,
         CASE WHEN count(*) FILTER (WHERE observed <> expected) = 0
              THEN 'OK: retention sweep (both branches), feed archive view and mark-all-read landed as written'
              ELSE 'STOP: ' || count(*) FILTER (WHERE observed <> expected)::text || ' assertion(s) FAIL, read the rows above'
         END AS verdict
  FROM a
) AS v
ORDER BY seq;
