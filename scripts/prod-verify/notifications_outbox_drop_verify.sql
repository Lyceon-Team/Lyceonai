-- ===========================================================================
-- NOTIFICATIONS REBUILD — POST-APPLY VERIFY (after 20260903010000_drop_notification_outbox.sql)
-- ===========================================================================
-- READ-ONLY. Paste into the Supabase SQL editor and run. Nothing here writes.
--
-- @spec [contracts/notifications.contract.md C0.2 (the outbox is gone);
--        Doc-01_V8 §40.2.1 (the deletion cascade names the tables it clears)]
-- @implemented [2026-09-03]
--
-- plain English: Migration B is two things — the old table is dropped, and the account
-- deletion cascade function's own comment names the rebuilt tables instead of the
-- dropped one. One row per assertion, expected inline, overall last. Run this only
-- after notifications_rebuild_verify.sql reads OK; B does not touch A's objects.
-- ===========================================================================

WITH a(seq, assertion, expected, observed) AS (
  VALUES
  ( 1, 'table public.notification_outbox absent',
       'absent',
       CASE WHEN to_regclass('public.notification_outbox') IS NULL THEN 'absent' ELSE 'STILL PRESENT' END),
  ( 2, 'execute_account_deletion_cascade body no longer mentions notification_outbox',
       'absent',
       coalesce((SELECT CASE WHEN bool_or(position('notification_outbox' IN pg_get_functiondef(p.oid)) > 0)
                             THEN 'STILL MENTIONED' ELSE 'absent' END
                   FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'execute_account_deletion_cascade'), 'MISSING')),
  ( 3, 'execute_account_deletion_cascade body names notification_events, notification_messages',
       'present',
       coalesce((SELECT CASE WHEN bool_or(position('notification_events, notification_messages' IN pg_get_functiondef(p.oid)) > 0)
                             THEN 'present' ELSE 'absent' END
                   FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'execute_account_deletion_cascade'), 'MISSING')),
  ( 4, 'the rebuilt tables survived B: notification_events and notification_messages present',
       'present',
       CASE WHEN to_regclass('public.notification_events') IS NULL
              OR to_regclass('public.notification_messages') IS NULL
            THEN 'MISSING' ELSE 'present' END)
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
              THEN 'OK: notification_outbox is gone and the deletion cascade names the rebuilt tables'
              ELSE 'STOP: ' || count(*) FILTER (WHERE observed <> expected)::text || ' assertion(s) FAIL, read the rows above'
         END AS verdict
  FROM a
) AS v
ORDER BY seq;
