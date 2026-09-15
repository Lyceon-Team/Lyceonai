-- ===========================================================================
-- NOTIFICATIONS — RETENTION SWEEP: ORPHANED DELIVERY EVENTS (amendment to 20260915100000)
-- ===========================================================================
-- @spec [contracts/notifications.contract.md §11 (C11.1 one window, C11.2 the sweep's two
--        branches, C11.3 every run logged with both counts); §6.5 (the `unmatched` class:
--        a webhook that arrives before, or after, the message it names); Doc-06D_V1.0 §9
--        (retention drift); owner brief 2026-09-16 "Retention Sweep Amendment: Orphaned
--        Delivery Events"] | @implemented [2026-09-16]
--
-- plain English: the sweep from 20260915100000 deletes expired notification_events and
-- lets the FK cascade take their messages and the delivery events attached to those
-- messages. A delivery event with NO message (`message_id IS NULL` — a provider webhook
-- that never matched, or one that arrives AFTER its message was swept) has no parent, so
-- the cascade never reaches it. Worse, the sweep MANUFACTURES that class: once messages
-- age out, every late webhook for a swept message lands unmatched and would persist for
-- ever — the mechanism built to bound growth would feed an unbounded table.
--
-- This recreates the ONE sweep function in full, adding a second branch in the SAME
-- function, SAME transaction, SAME cutoff: delete unmatched delivery events whose
-- `received_at` is older than the window (an orphan has no parent whose created_at could
-- apply). The matched path is untouched — the cascade remains the mechanism for every row
-- that has a parent; this branch covers the orphan class only. The rows carry provider
-- ids, an event type, timestamps and an outcome — no personal data — which is why the same
-- window applies and no separate retention policy is needed.
--
-- BATCH BOUND ACROSS TWO STATEMENTS: p_batch_size bounds EACH branch independently
-- (at most p_batch_size events AND at most p_batch_size orphans per call), not a shared
-- budget. A shared budget would let a large event backlog starve orphan cleanup for as many
-- runs as the backlog lasts — exactly the growth failure this amendment closes. Each branch
-- is still oldest-first and still finite per call.
--
-- WHY DROP + CREATE: the parameter list is unchanged but the RETURNS TABLE gains a column,
-- and CREATE OR REPLACE cannot change a function's return type. DROP by exact signature,
-- CREATE, restate the grants. Idempotent on re-run.
-- ===========================================================================

DROP FUNCTION IF EXISTS public.sweep_notification_retention(integer);

CREATE OR REPLACE FUNCTION public.sweep_notification_retention(p_batch_size integer)
RETURNS TABLE (
  deleted_events                   integer,
  deleted_messages                 integer,
  deleted_orphan_delivery_events   integer,
  cutoff                           timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cutoff                          timestamptz;
  v_deleted_events                  integer;
  v_deleted_messages                integer;
  v_deleted_orphan_delivery_events  integer;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 THEN
    RAISE EXCEPTION 'sweep_notification_retention: p_batch_size must be >= 1 (got %)', p_batch_size
      USING ERRCODE = '22023';
  END IF;

  -- ONE cutoff for both branches, from the ONE window definition.
  v_cutoff := now() - make_interval(days => public.notification_retention_days());

  -- Branch 1 — the parent path. Expired events go; messages and the delivery events
  -- attached to them go by FK cascade. Every CTE sees the same snapshot, so
  -- `doomed_messages` counts the messages the DELETE's cascade is about to remove.
  WITH doomed AS (
    SELECT e.event_id
      FROM public.notification_events e
     WHERE e.created_at < v_cutoff
     ORDER BY e.created_at ASC, e.event_id ASC
     LIMIT p_batch_size
  ),
  doomed_messages AS (
    SELECT count(*)::integer AS n
      FROM public.notification_messages m
     WHERE m.event_id IN (SELECT d.event_id FROM doomed d)
  ),
  deleted AS (
    DELETE FROM public.notification_events e
     WHERE e.event_id IN (SELECT d.event_id FROM doomed d)
    RETURNING e.event_id
  )
  SELECT (SELECT count(*)::integer FROM deleted), (SELECT n FROM doomed_messages)
    INTO v_deleted_events, v_deleted_messages;

  -- Branch 2 — the orphan path. A delivery event with no message has no parent to cascade
  -- from; it is aged on its own `received_at` against the SAME cutoff. Bounded on its own.
  WITH doomed_orphans AS (
    SELECT d.provider_event_id
      FROM public.notification_delivery_events d
     WHERE d.message_id IS NULL
       AND d.received_at < v_cutoff
     ORDER BY d.received_at ASC, d.provider_event_id ASC
     LIMIT p_batch_size
  ),
  deleted_orphans AS (
    DELETE FROM public.notification_delivery_events d
     WHERE d.provider_event_id IN (SELECT o.provider_event_id FROM doomed_orphans o)
    RETURNING d.provider_event_id
  )
  SELECT count(*)::integer INTO v_deleted_orphan_delivery_events FROM deleted_orphans;

  deleted_events                 := v_deleted_events;
  deleted_messages               := v_deleted_messages;
  deleted_orphan_delivery_events := v_deleted_orphan_delivery_events;
  cutoff                         := v_cutoff;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.sweep_notification_retention(integer) IS
  'contracts/notifications.contract.md C11.2: ONE window (notification_retention_days()), two branches in one transaction — (1) notification_events older than the window, oldest first, at most p_batch_size per call, messages and matched delivery events by FK cascade; (2) unmatched delivery events (message_id IS NULL) whose received_at is older than the same window, at most p_batch_size per call. Returns both counts and the cutoff so every run can be logged.';

REVOKE ALL ON FUNCTION public.sweep_notification_retention(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sweep_notification_retention(integer) TO service_role;
