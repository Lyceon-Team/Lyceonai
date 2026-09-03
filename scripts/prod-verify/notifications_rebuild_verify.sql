-- ===========================================================================
-- NOTIFICATIONS REBUILD — POST-APPLY VERIFY (after 20260903000000_notifications_rebuild.sql)
-- ===========================================================================
-- READ-ONLY against application data. Paste into the Supabase SQL editor and run.
-- The only objects this file creates live in pg_temp and vanish with the session.
--
-- @spec [contracts/notifications.contract.md C1.1–C1.5 (schema, cascade, RLS),
--        C2.2 (emit inside the link RPC), C9.1–C9.3 (policies, column guard);
--        Doc-01_V8 §36.1 step 6, §40.2.1 (account deletion cascades through profiles)]
-- @implemented [2026-09-03]
--
-- plain English: one row per assertion, each with the expected value written INLINE
-- and the observed value read from the catalog, so the operator compares two columns
-- and reads PASS/FAIL. The last row is the overall verdict. Standing rule: prod
-- verification runs from this committed file, never from queries read out of a
-- document.
--
-- THE NEGATIVE CONTROL (rows 21–22). The load-bearing assertion is that both
-- profiles(id) foreign keys read ON DELETE CASCADE: account deletion (Doc 01 §40.2.1)
-- removes the profile row and relies on the cascade to take the notification rows with
-- it; a NO ACTION key would make the deletion fail. An assertion that is never seen
-- failing proves nothing, so this file builds two throwaway pg_temp tables with a
-- foreign key each — one ON DELETE NO ACTION, one ON DELETE CASCADE — and runs the SAME
-- function the production rows use against both. Row 22 passes only when that function
-- reports FAIL for the NO ACTION key; row 21 only when it reports PASS for the CASCADE
-- key. If either control fails, the cascade rows above cannot be trusted and the
-- overall verdict is STOP regardless of what they say.
--
-- WHY THE FOUR CASCADE ROWS READ pg_constraint AND NOT THE MIGRATION FILE. The file says
-- CASCADE; production is what the operator is verifying. confdeltype is the applied
-- truth: c = CASCADE, a = NO ACTION, r = RESTRICT, n = SET NULL, d = SET DEFAULT.
-- ===========================================================================

-- The one function every foreign-key row (production and control) goes through.
CREATE FUNCTION pg_temp.nv_fk_delete_action(p_child regclass, p_conname text)
RETURNS text
LANGUAGE sql
STABLE
AS $nv$
  SELECT coalesce(
    (SELECT CASE c.confdeltype
              WHEN 'c' THEN 'CASCADE'
              WHEN 'a' THEN 'NO ACTION'
              WHEN 'r' THEN 'RESTRICT'
              WHEN 'n' THEN 'SET NULL'
              WHEN 'd' THEN 'SET DEFAULT'
            END
       FROM pg_catalog.pg_constraint c
      WHERE c.contype = 'f'
        AND c.conrelid = p_child
        AND c.conname  = p_conname),
    'MISSING')
$nv$;

-- Controls: a temp parent, one child keyed NO ACTION, one keyed CASCADE. Temp tables may
-- reference only temp tables, hence the private parent rather than public.profiles.
CREATE TEMP TABLE nv_control_parent (id integer PRIMARY KEY);
CREATE TEMP TABLE nv_control_child_noaction (
  parent_id integer,
  CONSTRAINT nv_control_noaction_fkey FOREIGN KEY (parent_id)
    REFERENCES pg_temp.nv_control_parent (id) ON DELETE NO ACTION
);
CREATE TEMP TABLE nv_control_child_cascade (
  parent_id integer,
  CONSTRAINT nv_control_cascade_fkey FOREIGN KEY (parent_id)
    REFERENCES pg_temp.nv_control_parent (id) ON DELETE CASCADE
);

-- VERDICT — one row per assertion, overall last. The overall row is derived from the
-- same rows it summarises (one CTE), so it cannot drift from them.
WITH a(seq, assertion, expected, observed) AS (
  VALUES
    -- tables --------------------------------------------------------------------
    ( 1, 'table public.notification_events present',
         'present',
         CASE WHEN to_regclass('public.notification_events') IS NULL THEN 'MISSING' ELSE 'present' END),
    ( 2, 'table public.notification_messages present',
         'present',
         CASE WHEN to_regclass('public.notification_messages') IS NULL THEN 'MISSING' ELSE 'present' END),
    ( 3, 'table public.notification_delivery_events present',
         'present',
         CASE WHEN to_regclass('public.notification_delivery_events') IS NULL THEN 'MISSING' ELSE 'present' END),
    -- RLS enabled (C1.5) -----------------------------------------------------------
    ( 4, 'RLS enabled on public.notification_events',
         'enabled',
         coalesce((SELECT CASE WHEN relrowsecurity THEN 'enabled' ELSE 'DISABLED' END
                     FROM pg_catalog.pg_class WHERE oid = to_regclass('public.notification_events')), 'MISSING')),
    ( 5, 'RLS enabled on public.notification_messages',
         'enabled',
         coalesce((SELECT CASE WHEN relrowsecurity THEN 'enabled' ELSE 'DISABLED' END
                     FROM pg_catalog.pg_class WHERE oid = to_regclass('public.notification_messages')), 'MISSING')),
    ( 6, 'RLS enabled on public.notification_delivery_events',
         'enabled',
         coalesce((SELECT CASE WHEN relrowsecurity THEN 'enabled' ELSE 'DISABLED' END
                     FROM pg_catalog.pg_class WHERE oid = to_regclass('public.notification_delivery_events')), 'MISSING')),
    -- ON DELETE CASCADE (C1.3): the two profiles keys, then the two internal keys ---
    ( 7, 'FK notification_events.subject_profile_id -> public.profiles(id) ON DELETE',
         'CASCADE',
         pg_temp.nv_fk_delete_action(to_regclass('public.notification_events'),
                                     'notification_events_subject_profile_id_fkey')),
    ( 8, 'FK notification_messages.recipient_profile_id -> public.profiles(id) ON DELETE',
         'CASCADE',
         pg_temp.nv_fk_delete_action(to_regclass('public.notification_messages'),
                                     'notification_messages_recipient_profile_id_fkey')),
    ( 9, 'FK notification_messages.event_id -> public.notification_events(event_id) ON DELETE',
         'CASCADE',
         pg_temp.nv_fk_delete_action(to_regclass('public.notification_messages'),
                                     'notification_messages_event_id_fkey')),
    (10, 'FK notification_delivery_events.message_id -> public.notification_messages(message_id) ON DELETE',
         'CASCADE',
         pg_temp.nv_fk_delete_action(to_regclass('public.notification_delivery_events'),
                                     'notification_delivery_events_message_id_fkey')),
    -- policies (C9.1): two self-scope policies on messages, none anywhere else --------
    (11, 'policy notification_messages_select_self',
         'SELECT to {authenticated} USING (recipient_profile_id = auth.uid())',
         coalesce((SELECT cmd || ' to ' || roles::text || ' USING ' || qual
                     FROM pg_catalog.pg_policies
                    WHERE schemaname = 'public' AND tablename = 'notification_messages'
                      AND policyname = 'notification_messages_select_self'), 'MISSING')),
    (12, 'policy notification_messages_update_self',
         'UPDATE to {authenticated} USING (recipient_profile_id = auth.uid()) WITH CHECK (recipient_profile_id = auth.uid())',
         coalesce((SELECT cmd || ' to ' || roles::text || ' USING ' || qual || ' WITH CHECK ' || with_check
                     FROM pg_catalog.pg_policies
                    WHERE schemaname = 'public' AND tablename = 'notification_messages'
                      AND policyname = 'notification_messages_update_self'), 'MISSING')),
    (13, 'policy count on public.notification_messages (exactly the two above)',
         '2',
         (SELECT count(*)::text FROM pg_catalog.pg_policies
           WHERE schemaname = 'public' AND tablename = 'notification_messages')),
    (14, 'policy count on public.notification_events (absence is the denial)',
         '0',
         (SELECT count(*)::text FROM pg_catalog.pg_policies
           WHERE schemaname = 'public' AND tablename = 'notification_events')),
    (15, 'policy count on public.notification_delivery_events (absence is the denial)',
         '0',
         (SELECT count(*)::text FROM pg_catalog.pg_policies
           WHERE schemaname = 'public' AND tablename = 'notification_delivery_events')),
    -- column guard (C9.2) ---------------------------------------------------------------
    (16, 'trigger notification_messages_recipient_guard on public.notification_messages',
         'BEFORE UPDATE FOR EACH ROW EXECUTE public.notification_messages_guard_recipient_update() enabled',
         coalesce((SELECT CASE WHEN (t.tgtype & 2) = 2 THEN 'BEFORE' ELSE 'NOT BEFORE' END
                       || CASE WHEN (t.tgtype & 16) = 16 THEN ' UPDATE' ELSE ' NOT UPDATE' END
                       || CASE WHEN (t.tgtype & 1) = 1 THEN ' FOR EACH ROW' ELSE ' FOR EACH STATEMENT' END
                       || ' EXECUTE ' || pn.nspname || '.' || p.proname || '()'
                       || CASE WHEN t.tgenabled = 'D' THEN ' DISABLED' ELSE ' enabled' END
                     FROM pg_catalog.pg_trigger t
                     JOIN pg_catalog.pg_proc p       ON p.oid = t.tgfoid
                     JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace
                    WHERE t.tgrelid = to_regclass('public.notification_messages')
                      AND t.tgname = 'notification_messages_recipient_guard'
                      AND NOT t.tgisinternal), 'MISSING')),
    (17, 'guard function raises SQLSTATE 42501 for the recipient roles',
         'raises 42501',
         coalesce((SELECT CASE WHEN bool_or(position('42501' IN p.prosrc) > 0) THEN 'raises 42501' ELSE 'no 42501' END
                     FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'public' AND p.proname = 'notification_messages_guard_recipient_update'), 'MISSING')),
    -- emit inside the link RPC (C2.2; Doc 01 §36.1 step 6) --------------------------------
    (18, 'create_active_guardian_link_audited body contains PERFORM public.emit_notification_event(',
         'present',
         coalesce((SELECT CASE WHEN bool_or(position('PERFORM public.emit_notification_event(' IN pg_get_functiondef(p.oid)) > 0)
                               THEN 'present' ELSE 'absent' END
                     FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'public' AND p.proname = 'create_active_guardian_link_audited'), 'MISSING')),
    -- CHECK narrowed to the single launch value (C1.1; rulings R7/R8) ----------------------
    (19, 'CHECK notification_events_type_check, as PostgreSQL renders it',
         'CHECK ((event_type = ''guardian_linked''::text))',
         coalesce((SELECT pg_get_constraintdef(c.oid) FROM pg_catalog.pg_constraint c
                    WHERE c.conrelid = to_regclass('public.notification_events')
                      AND c.conname = 'notification_events_type_check'), 'MISSING')),
    -- the nine SQL functions the server calls --------------------------------------------
    (20, 'nine notification functions present in public',
         '9',
         (SELECT count(*)::text FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public'
             AND p.proname IN ('notification_event_id', 'emit_notification_event', 'notification_apply_transition',
                               'record_notification_send_attempt', 'apply_notification_delivery_event',
                               'notification_feed', 'notification_unread_count', 'mark_notification',
                               'mark_all_notifications_seen'))),
    -- controls: the cascade assertion must PASS a CASCADE key and FAIL a NO ACTION key ------
    (21, 'CONTROL (positive): cascade assertion against a temp FK declared ON DELETE CASCADE',
         'PASS',
         CASE WHEN pg_temp.nv_fk_delete_action(to_regclass('pg_temp.nv_control_child_cascade'),
                                               'nv_control_cascade_fkey') = 'CASCADE'
              THEN 'PASS' ELSE 'FAIL' END),
    (22, 'CONTROL (negative): cascade assertion against a temp FK declared ON DELETE NO ACTION',
         'FAIL',
         CASE WHEN pg_temp.nv_fk_delete_action(to_regclass('pg_temp.nv_control_child_noaction'),
                                               'nv_control_noaction_fkey') = 'CASCADE'
              THEN 'PASS' ELSE 'FAIL' END)
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
              THEN 'OK: Migration A landed as written (both profiles keys CASCADE, RLS + two self policies + column guard, RPC emits, CHECK is guardian_linked only, controls behaved)'
              ELSE 'STOP: ' || count(*) FILTER (WHERE observed <> expected)::text || ' assertion(s) FAIL, read the rows above'
         END AS verdict
  FROM a
) AS v
ORDER BY seq;
