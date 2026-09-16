-- ===========================================================================
-- NOTIFICATIONS — RETENTION SWEEP + FEED ARCHIVE VIEW + MARK-ALL-READ
-- ===========================================================================
-- @spec [contracts/notifications.contract.md §11 (C11.1 90-day window, C11.2 the sweep,
--        C11.3 every run is logged), §3.1/§3.2 (feed archive view, mark-all-read);
--        Doc-01_V8 §5.1 (the 90-day authentication-event tier this data adopts — SCL-082
--        PROPOSED); Doc-06D_V1.0 §9 (a retention rule with no mechanism is retention drift);
--        Doc-07E_V1.0 §5 (retention class taxonomy); owner brief 2026-09-15
--        "Notification Retention Sweep + Notifications Page"] | @implemented [2026-09-15]
--
-- plain English (three things, one file):
--
--  1. THE WINDOW, ONCE. `notification_retention_days()` is the single definition of the
--     retention window. The sweep reads it; nothing else states "90". A change to 60 or 120
--     days is one edit here, and the PG suite asserts the function against the contract.
--
--  2. THE SWEEP. `sweep_notification_retention(p_batch_size)` deletes notification_events
--     rows older than the window, oldest first, at most p_batch_size per call. Both foreign
--     keys cascade (messages → from events; delivery events → from messages), so ONE
--     statement is the whole mechanism; there is deliberately no second delete for
--     notification_messages — a second path would be a second derivation of the same rule.
--     It returns the counts it deleted AND the cutoff it used, so the caller can log a run
--     that deleted nothing in a way that is distinguishable from a run that never happened.
--
--  3. THE FEED, WITH ARCHIVE. `notification_feed` gains `p_archived` (default false, so
--     every existing caller keeps its behaviour) and returns `archived_at`, so the
--     notifications page can show archived items on request. `mark_all_notifications_read`
--     is the read counterpart of `mark_all_notifications_seen`; read also implies seen.
--
-- IDEMPOTENT. CREATE OR REPLACE throughout; the old three-argument notification_feed is
-- dropped by exact signature (a CREATE OR REPLACE with a new parameter list would add an
-- overload, not replace it) and the grants are restated.
-- ===========================================================================

-- ── 1. The retention window — one definition ───────────────────────────────

CREATE OR REPLACE FUNCTION public.notification_retention_days()
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT 90;
$$;

COMMENT ON FUNCTION public.notification_retention_days() IS
  'contracts/notifications.contract.md C11.1: the notification retention window in days. THE single definition; the sweep reads it.';

-- ── 2. The sweep ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sweep_notification_retention(p_batch_size integer)
RETURNS TABLE (
  deleted_events    integer,
  deleted_messages  integer,
  cutoff            timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cutoff            timestamptz;
  v_deleted_events    integer;
  v_deleted_messages  integer;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 THEN
    RAISE EXCEPTION 'sweep_notification_retention: p_batch_size must be >= 1 (got %)', p_batch_size
      USING ERRCODE = '22023';
  END IF;

  v_cutoff := now() - make_interval(days => public.notification_retention_days());

  -- Every CTE in one statement sees the same snapshot, so `doomed_messages` counts the
  -- messages that the DELETE's cascade is about to remove — the cascade is what is proven.
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

  deleted_events   := v_deleted_events;
  deleted_messages := v_deleted_messages;
  cutoff           := v_cutoff;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.sweep_notification_retention(integer) IS
  'contracts/notifications.contract.md C11.2: deletes notification_events older than notification_retention_days(), oldest first, at most p_batch_size per call; messages and delivery events go by FK cascade. Returns counts and the cutoff so every run can be logged.';

REVOKE ALL ON FUNCTION public.notification_retention_days() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sweep_notification_retention(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notification_retention_days() TO service_role;
GRANT EXECUTE ON FUNCTION public.sweep_notification_retention(integer) TO service_role;

-- ── 3. The feed, with an archive view ───────────────────────────────────────

DROP FUNCTION IF EXISTS public.notification_feed(uuid, integer, uuid);

CREATE OR REPLACE FUNCTION public.notification_feed(
  p_recipient_id        uuid,
  p_limit               integer,
  p_before_message_id   uuid    DEFAULT NULL,
  p_archived            boolean DEFAULT false
) RETURNS TABLE (
  message_id          uuid,
  event_id            uuid,
  event_type          text,
  subject_profile_id  uuid,
  payload             jsonb,
  created_at          timestamptz,
  seen_at             timestamptz,
  read_at             timestamptz,
  archived_at         timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.message_id, m.event_id, e.event_type, e.subject_profile_id, e.payload,
         m.created_at, m.seen_at, m.read_at, m.archived_at
    FROM public.notification_messages m
    JOIN public.notification_events   e ON e.event_id = m.event_id
   WHERE m.recipient_profile_id = p_recipient_id
     AND m.channel = 'in_app'
     -- One view or the other, never both: the inbox is the unarchived rows, the archive is
     -- the archived rows. A row moves between them exactly when archived_at is set.
     AND ((m.archived_at IS NOT NULL) = p_archived)
     -- Keyset cursor keyed by message id only: the (created_at, message_id) tuple is read back
     -- here at full microsecond precision, so a client that carries timestamps at millisecond
     -- precision (or none) cannot skip or repeat a row. A cursor naming another recipient's
     -- message resolves to NULL and yields an empty page.
     AND (p_before_message_id IS NULL
          OR (m.created_at, m.message_id) < (
               SELECT b.created_at, b.message_id
                 FROM public.notification_messages b
                WHERE b.message_id = p_before_message_id
                  AND b.recipient_profile_id = p_recipient_id))
   ORDER BY m.created_at DESC, m.message_id DESC
   LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(p_recipient_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  -- Read implies seen (the same rule mark_notification applies per row). Archived rows are
  -- left alone: the archive is not the inbox, and "mark all read" is an inbox action.
  UPDATE public.notification_messages
     SET read_at = now(),
         seen_at = coalesce(seen_at, now())
   WHERE recipient_profile_id = p_recipient_id
     AND channel = 'in_app'
     AND archived_at IS NULL
     AND read_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.notification_feed(uuid, integer, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_all_notifications_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notification_feed(uuid, integer, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read(uuid) TO service_role;
