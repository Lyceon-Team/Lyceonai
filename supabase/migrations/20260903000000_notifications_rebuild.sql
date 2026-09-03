-- ---------------------------------------------------------------------------
-- Notifications rebuild — Migration A: schema, RLS, emit, dispatch/webhook SQL, feed.
-- LYCEON-MIGRATION-REVIEWED
--
-- @spec [contracts/notifications.contract.md §1, §2, §4, §5, §6.5, §7.5, §9;
--        Doc-01_V8 §36.1 step 6 "Both parties notified", §38.1/§38.2 guardian
--        aggregate-only visibility; Doc-01A_V1.0 §14 PII redaction;
--        lyceon-coding-standards §4.2 idempotency]
-- @implemented 2026-09-03
--
-- plain English: one event row per notifiable moment, written IN THE SAME TRANSACTION as
-- the mutation that makes the moment true, fanned out to one message row per
-- (recipient, channel). In-app messages are delivered the instant they exist — the row is
-- the feed item. Email messages start `queued` and are moved by the application dispatcher
-- (through `record_notification_send_attempt`) and by verified Resend webhooks (through
-- `apply_notification_delivery_event`). Every state change that must be atomic lives in a
-- SQL function here, so "claimed but not applied" is unrepresentable from application code.
--
-- WHY `ON DELETE CASCADE` ON BOTH profiles(id) REFERENCES. Account deletion deletes the
-- profile row and lets FKs cascade (execute_account_deletion_cascade, 05d/05e). A NO ACTION
-- FK here would block that DELETE and break account deletion in production. The cascade is
-- proved positively AND by a negative control in tests/ci/notifications.pg.ci.test.ts.
--
-- WHY THE RECIPIENT GUARD IS A TRIGGER. An RLS policy decides WHICH rows an UPDATE may
-- touch, not WHICH COLUMNS. `notification_messages_guard_recipient_update` compares OLD and
-- NEW on every column a recipient may not change and raises 42501 when the current role is
-- `authenticated` or `anon`. The service role (dispatcher, webhook) is unaffected.
--
-- WHY NOT guardian_can_view_student HERE. A guardian's message row is addressed to the
-- guardian; self-scope (`recipient_profile_id = auth.uid()`) covers it. The guardian-view
-- predicate governs access to STUDENT data and reusing it would create a second derivation.
--
-- DETERMINISTIC EVENT IDS. `notification_event_id(event_type, source_id)` is the first 16
-- bytes of sha256(event_type || ':' || source_id) with the RFC 4122 version nibble set to 5
-- and the variant bits set to 10. server/lib/notifications/event-id.ts derives the same
-- uuid; parity is asserted in the PG suite. Core `sha256()` — no extension dependency.
--
-- RESERVED EVENT TYPES. `guardian_consent_requested` and `account_deletion_scheduled` are
-- admitted by the CHECK but have NO emitter in this migration: the first addresses an email
-- with no profile row, the second needs a raw recovery token that must never be persisted.
-- Both wait on an owner ruling (contract §2.3).
--
-- IDEMPOTENT. CREATE TABLE / CREATE INDEX / CREATE POLICY guard with IF NOT EXISTS where
-- Postgres allows it; functions are CREATE OR REPLACE; the trigger is dropped-then-created.
--
-- NOT APPLIED BY THIS SESSION — the owner applies all SQL.
--
-- rollback:
--   DROP TRIGGER IF EXISTS notification_messages_recipient_guard ON public.notification_messages;
--   DROP FUNCTION IF EXISTS public.notification_messages_guard_recipient_update();
--   DROP FUNCTION IF EXISTS public.mark_all_notifications_seen(uuid);
--   DROP FUNCTION IF EXISTS public.mark_notification(uuid, uuid, boolean, boolean, boolean);
--   DROP FUNCTION IF EXISTS public.notification_unread_count(uuid);
--   DROP FUNCTION IF EXISTS public.notification_feed(uuid, integer, uuid);
--   DROP FUNCTION IF EXISTS public.apply_notification_delivery_event(text, text, text, timestamptz);
--   DROP FUNCTION IF EXISTS public.record_notification_send_attempt(uuid, boolean, text, text, integer);
--   DROP FUNCTION IF EXISTS public.notification_apply_transition(uuid, text);
--   DROP FUNCTION IF EXISTS public.emit_notification_event(uuid, text, uuid, jsonb, jsonb);
--   DROP FUNCTION IF EXISTS public.notification_event_id(text, text);
--   DROP TABLE IF EXISTS public.notification_delivery_events;
--   DROP TABLE IF EXISTS public.notification_messages;
--   DROP TABLE IF EXISTS public.notification_events;
--   (create_active_guardian_link_audited is restored to its pre-emit body by re-running
--    20260901000000_scl_080_guardian_link_code.sql.)
-- ---------------------------------------------------------------------------

BEGIN;

-- ===========================================================================
-- Tables
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.notification_events (
  event_id            uuid PRIMARY KEY,
  event_type          text NOT NULL,
  subject_profile_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_events_type_check CHECK (event_type IN (
    'guardian_linked', 'guardian_consent_requested', 'account_deletion_scheduled'))
);

COMMENT ON TABLE public.notification_events IS
  'One row per notifiable moment, written in the same transaction as the mutation that produced it. '
  'payload holds identifiers and rendering parameters only (contract §8). Service-role only.';

CREATE TABLE IF NOT EXISTS public.notification_messages (
  message_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id              uuid NOT NULL REFERENCES public.notification_events(event_id) ON DELETE CASCADE,
  recipient_profile_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  channel               text NOT NULL CHECK (channel IN ('in_app','email')),
  status                text NOT NULL DEFAULT 'queued'
                          CHECK (status IN ('queued','sent','delivered','bounced','complained','failed')),
  provider_message_id   text,
  attempts              integer NOT NULL DEFAULT 0,
  last_error            text,
  seen_at               timestamptz,
  read_at               timestamptz,
  archived_at           timestamptz,
  sent_at               timestamptz,
  delivered_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_messages_unique UNIQUE (event_id, recipient_profile_id, channel)
);

COMMENT ON TABLE public.notification_messages IS
  'One row per (event, recipient, channel). in_app rows are delivered on insert and ARE the feed; '
  'email rows are moved queued->sent by the dispatcher and onward by verified provider webhooks.';

CREATE INDEX IF NOT EXISTS notification_messages_feed_idx
  ON public.notification_messages (recipient_profile_id, created_at DESC)
  WHERE channel = 'in_app' AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS notification_messages_dispatch_idx
  ON public.notification_messages (created_at)
  WHERE channel = 'email' AND status = 'queued';

-- Provider webhook lookup: the dispatcher writes provider_message_id once; the webhook
-- receiver resolves the row by it.
CREATE INDEX IF NOT EXISTS notification_messages_provider_idx
  ON public.notification_messages (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- Every verified provider webhook, exactly once (provider_event_id = svix-id). A row with
-- message_id NULL is an event that arrived before the dispatcher recorded the send, or one
-- for a message this system never sent (the Resend account also carries Supabase Auth mail).
CREATE TABLE IF NOT EXISTS public.notification_delivery_events (
  provider_event_id    text PRIMARY KEY,
  provider_message_id  text NOT NULL,
  event_type           text NOT NULL,
  occurred_at          timestamptz NOT NULL,
  received_at          timestamptz NOT NULL DEFAULT now(),
  message_id           uuid NULL REFERENCES public.notification_messages(message_id) ON DELETE CASCADE,
  outcome              text NOT NULL DEFAULT 'unmatched'
                         CHECK (outcome IN ('applied','ignored','unmatched')),
  applied_at           timestamptz NULL
);

COMMENT ON TABLE public.notification_delivery_events IS
  'Verified provider (Resend/Svix) webhook receipts. Dedupe key is the svix-id. Inserted and '
  'applied in ONE function call (apply_notification_delivery_event) so claimed-but-not-applied '
  'is unrepresentable. Unmatched rows are reconciled when the dispatcher records the send.';

CREATE INDEX IF NOT EXISTS notification_delivery_events_unmatched_idx
  ON public.notification_delivery_events (provider_message_id, occurred_at)
  WHERE message_id IS NULL;

-- ===========================================================================
-- RLS and grants
-- ===========================================================================

ALTER TABLE public.notification_events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_delivery_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.notification_events          FROM PUBLIC;
REVOKE ALL ON public.notification_messages        FROM PUBLIC;
REVOKE ALL ON public.notification_delivery_events FROM PUBLIC;

GRANT ALL ON public.notification_events          TO service_role;
GRANT ALL ON public.notification_messages        TO service_role;
GRANT ALL ON public.notification_delivery_events TO service_role;

-- Recipients read and annotate their own rows. No INSERT, no DELETE, nothing for anon.
GRANT SELECT, UPDATE ON public.notification_messages TO authenticated;

DROP POLICY IF EXISTS notification_messages_select_self ON public.notification_messages;
CREATE POLICY notification_messages_select_self
  ON public.notification_messages FOR SELECT TO authenticated
  USING (recipient_profile_id = auth.uid());

DROP POLICY IF EXISTS notification_messages_update_self ON public.notification_messages;
CREATE POLICY notification_messages_update_self
  ON public.notification_messages FOR UPDATE TO authenticated
  USING (recipient_profile_id = auth.uid())
  WITH CHECK (recipient_profile_id = auth.uid());

-- (notification_events / notification_delivery_events: no policy. Absence is the denial.)

-- ===========================================================================
-- Recipient column guard (contract §9.2)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.notification_messages_guard_recipient_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- SECURITY INVOKER: current_user is the role issuing the UPDATE. The dispatcher and the
  -- webhook receiver run as service_role (or as the SECURITY DEFINER owner) and pass through.
  IF current_user IN ('authenticated', 'anon') THEN
    IF NEW.message_id           IS DISTINCT FROM OLD.message_id
    OR NEW.event_id             IS DISTINCT FROM OLD.event_id
    OR NEW.recipient_profile_id IS DISTINCT FROM OLD.recipient_profile_id
    OR NEW.channel              IS DISTINCT FROM OLD.channel
    OR NEW.status               IS DISTINCT FROM OLD.status
    OR NEW.provider_message_id  IS DISTINCT FROM OLD.provider_message_id
    OR NEW.attempts             IS DISTINCT FROM OLD.attempts
    OR NEW.last_error           IS DISTINCT FROM OLD.last_error
    OR NEW.sent_at              IS DISTINCT FROM OLD.sent_at
    OR NEW.delivered_at         IS DISTINCT FROM OLD.delivered_at
    OR NEW.created_at           IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'notification_messages: a recipient may change only seen_at, read_at and archived_at'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notification_messages_recipient_guard ON public.notification_messages;
CREATE TRIGGER notification_messages_recipient_guard
  BEFORE UPDATE ON public.notification_messages
  FOR EACH ROW EXECUTE FUNCTION public.notification_messages_guard_recipient_update();

-- ===========================================================================
-- Deterministic event id (contract §5.1)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.notification_event_id(p_event_type text, p_source_id text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE STRICT
AS $$
DECLARE
  v_bytes bytea;
BEGIN
  v_bytes := substring(sha256(convert_to(p_event_type || ':' || p_source_id, 'UTF8')) FROM 1 FOR 16);
  v_bytes := set_byte(v_bytes, 6, (get_byte(v_bytes, 6) & 15) | 80);   -- version 5 nibble
  v_bytes := set_byte(v_bytes, 8, (get_byte(v_bytes, 8) & 63) | 128);  -- RFC 4122 variant
  RETURN encode(v_bytes, 'hex')::uuid;
END;
$$;

-- ===========================================================================
-- Emit (contract §2)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.emit_notification_event(
  p_event_id            uuid,
  p_event_type          text,
  p_subject_profile_id  uuid,
  p_recipients          jsonb,   -- [{"profile_id": "...", "channels": ["in_app","email"]}, ...]
  p_payload             jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_recipients IS NULL OR jsonb_typeof(p_recipients) <> 'array' THEN
    RAISE EXCEPTION 'emit_notification_event: p_recipients must be a JSON array'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.notification_events (event_id, event_type, subject_profile_id, payload)
  VALUES (p_event_id, p_event_type, p_subject_profile_id, coalesce(p_payload, '{}'::jsonb))
  ON CONFLICT (event_id) DO NOTHING;

  -- in_app rows are the delivery: delivered on insert. email rows start queued.
  INSERT INTO public.notification_messages
    (event_id, recipient_profile_id, channel, status, delivered_at)
  SELECT
    p_event_id,
    (r ->> 'profile_id')::uuid,
    c.channel,
    CASE WHEN c.channel = 'in_app' THEN 'delivered' ELSE 'queued' END,
    CASE WHEN c.channel = 'in_app' THEN now() ELSE NULL END
  FROM jsonb_array_elements(p_recipients) AS r
  CROSS JOIN LATERAL jsonb_array_elements_text(r -> 'channels') AS c(channel)
  ON CONFLICT (event_id, recipient_profile_id, channel) DO NOTHING;
END;
$$;

-- ===========================================================================
-- Status transitions (contract §4) — the ONE place a webhook-driven change is decided
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.notification_apply_transition(
  p_message_id  uuid,
  p_event_type  text   -- provider event type: email.delivered | email.bounced | email.complained | email.failed
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
  v_next   text;
BEGIN
  SELECT status INTO v_status
    FROM public.notification_messages
   WHERE message_id = p_message_id AND channel = 'email'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_next := CASE
    WHEN p_event_type = 'email.delivered'  AND v_status = 'sent'                      THEN 'delivered'
    WHEN p_event_type = 'email.bounced'    AND v_status IN ('sent', 'delivered')      THEN 'bounced'
    WHEN p_event_type = 'email.complained' AND v_status IN ('sent', 'delivered')      THEN 'complained'
    WHEN p_event_type = 'email.failed'     AND v_status = 'sent'                      THEN 'failed'
    ELSE NULL
  END;

  IF v_next IS NULL THEN
    RETURN false;   -- illegal or no-op transition: recorded by the caller, never applied
  END IF;

  UPDATE public.notification_messages
     SET status       = v_next,
         delivered_at = CASE WHEN v_next = 'delivered' THEN now() ELSE delivered_at END,
         last_error   = CASE WHEN v_next = 'failed' THEN 'provider reported email.failed' ELSE last_error END
   WHERE message_id = p_message_id;
  RETURN true;
END;
$$;

-- ===========================================================================
-- Dispatcher record (contract §4.1, §4.2, §6.5)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.record_notification_send_attempt(
  p_message_id           uuid,
  p_ok                   boolean,
  p_provider_message_id  text,
  p_error                text,
  p_max_attempts         integer
) RETURNS SETOF public.notification_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row  public.notification_messages;
  v_ev   record;
  v_applied boolean;
BEGIN
  SELECT * INTO v_row
    FROM public.notification_messages
   WHERE message_id = p_message_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'record_notification_send_attempt: message % not found', p_message_id
      USING ERRCODE = 'LYN01';
  END IF;
  IF v_row.channel <> 'email' OR v_row.status <> 'queued' THEN
    RAISE EXCEPTION 'record_notification_send_attempt: message % is not a queued email (channel=%, status=%)',
      p_message_id, v_row.channel, v_row.status
      USING ERRCODE = 'LYN02';
  END IF;

  IF p_ok THEN
    IF p_provider_message_id IS NULL OR p_provider_message_id = '' THEN
      RAISE EXCEPTION 'record_notification_send_attempt: a successful send must carry a provider message id'
        USING ERRCODE = '22023';
    END IF;
    UPDATE public.notification_messages
       SET status              = 'sent',
           sent_at             = now(),
           provider_message_id = p_provider_message_id,
           attempts            = attempts + 1,
           last_error          = NULL
     WHERE message_id = p_message_id;

    -- Race closure (§6.5): webhooks that arrived before this record are applied now, oldest first.
    FOR v_ev IN
      SELECT provider_event_id, event_type
        FROM public.notification_delivery_events
       WHERE provider_message_id = p_provider_message_id
         AND message_id IS NULL
       ORDER BY occurred_at, received_at
       FOR UPDATE
    LOOP
      v_applied := public.notification_apply_transition(p_message_id, v_ev.event_type);
      UPDATE public.notification_delivery_events
         SET message_id = p_message_id,
             outcome    = CASE WHEN v_applied THEN 'applied' ELSE 'ignored' END,
             applied_at = now()
       WHERE provider_event_id = v_ev.provider_event_id;
    END LOOP;
  ELSE
    -- A failed send stays queued, distinguishable from an unattempted one by attempts/last_error,
    -- until the cap is reached. Never `sent`, never silently dropped.
    UPDATE public.notification_messages
       SET attempts   = attempts + 1,
           last_error = coalesce(p_error, 'send failed'),
           status     = CASE WHEN attempts + 1 >= p_max_attempts THEN 'failed' ELSE 'queued' END
     WHERE message_id = p_message_id;
  END IF;

  RETURN QUERY SELECT * FROM public.notification_messages WHERE message_id = p_message_id;
END;
$$;

-- ===========================================================================
-- Webhook receipt (contract §5.4, §7.4, §7.5)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.apply_notification_delivery_event(
  p_provider_event_id    text,
  p_provider_message_id  text,
  p_event_type           text,
  p_occurred_at          timestamptz
) RETURNS text   -- 'applied' | 'ignored' | 'unmatched' | 'duplicate'
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_message_id uuid;
  v_applied    boolean;
BEGIN
  INSERT INTO public.notification_delivery_events
    (provider_event_id, provider_message_id, event_type, occurred_at, outcome)
  VALUES (p_provider_event_id, p_provider_message_id, p_event_type, p_occurred_at, 'unmatched')
  ON CONFLICT (provider_event_id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN 'duplicate';
  END IF;

  SELECT message_id INTO v_message_id
    FROM public.notification_messages
   WHERE provider_message_id = p_provider_message_id
     AND channel = 'email'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'unmatched';   -- reconciled by record_notification_send_attempt if the send lands later
  END IF;

  v_applied := public.notification_apply_transition(v_message_id, p_event_type);

  UPDATE public.notification_delivery_events
     SET message_id = v_message_id,
         outcome    = CASE WHEN v_applied THEN 'applied' ELSE 'ignored' END,
         applied_at = now()
   WHERE provider_event_id = p_provider_event_id;

  RETURN CASE WHEN v_applied THEN 'applied' ELSE 'ignored' END;
END;
$$;

-- ===========================================================================
-- Feed (contract §3.1, §9.4) — recipient-scoped, service-role callable only
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.notification_feed(
  p_recipient_id        uuid,
  p_limit               integer,
  p_before_message_id   uuid DEFAULT NULL
) RETURNS TABLE (
  message_id          uuid,
  event_id            uuid,
  event_type          text,
  subject_profile_id  uuid,
  payload             jsonb,
  created_at          timestamptz,
  seen_at             timestamptz,
  read_at             timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.message_id, m.event_id, e.event_type, e.subject_profile_id, e.payload,
         m.created_at, m.seen_at, m.read_at
    FROM public.notification_messages m
    JOIN public.notification_events   e ON e.event_id = m.event_id
   WHERE m.recipient_profile_id = p_recipient_id
     AND m.channel = 'in_app'
     AND m.archived_at IS NULL
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

CREATE OR REPLACE FUNCTION public.notification_unread_count(p_recipient_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::integer
    FROM public.notification_messages
   WHERE recipient_profile_id = p_recipient_id
     AND channel = 'in_app'
     AND archived_at IS NULL
     AND seen_at IS NULL;
$$;

-- Timestamps are set once (first observation wins); read implies seen. Returns the row, or an
-- empty set when the message is not this recipient's — the route answers 404 either way.
CREATE OR REPLACE FUNCTION public.mark_notification(
  p_recipient_id  uuid,
  p_message_id    uuid,
  p_seen          boolean,
  p_read          boolean,
  p_archived      boolean
) RETURNS SETOF public.notification_messages
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.notification_messages
     SET seen_at     = CASE WHEN (p_seen OR p_read) AND seen_at IS NULL THEN now() ELSE seen_at END,
         read_at     = CASE WHEN p_read AND read_at IS NULL THEN now() ELSE read_at END,
         archived_at = CASE WHEN p_archived AND archived_at IS NULL THEN now() ELSE archived_at END
   WHERE message_id = p_message_id
     AND recipient_profile_id = p_recipient_id
     AND channel = 'in_app'
  RETURNING *;
$$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_seen(p_recipient_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.notification_messages
     SET seen_at = now()
   WHERE recipient_profile_id = p_recipient_id
     AND channel = 'in_app'
     AND archived_at IS NULL
     AND seen_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ===========================================================================
-- Function grants: service_role only. No authenticated execution anywhere.
-- ===========================================================================

REVOKE ALL ON FUNCTION public.notification_event_id(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.emit_notification_event(uuid, text, uuid, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notification_apply_transition(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_notification_send_attempt(uuid, boolean, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_notification_delivery_event(text, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notification_feed(uuid, integer, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notification_unread_count(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_notification(uuid, uuid, boolean, boolean, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_all_notifications_seen(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.notification_event_id(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.emit_notification_event(uuid, text, uuid, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_apply_transition(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_notification_send_attempt(uuid, boolean, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_notification_delivery_event(text, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_feed(uuid, integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_unread_count(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_notification(uuid, uuid, boolean, boolean, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_seen(uuid) TO service_role;

-- ===========================================================================
-- create_active_guardian_link_audited — recreated WHOLE, with the emit inside the
-- transaction (contract §2.2, §2.3). Body is verbatim from 20260901000000 plus the
-- student-name read and the PERFORM. Link behaviour is unchanged.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.create_active_guardian_link_audited(
  p_guardian_id  uuid,
  p_student_id   uuid,
  p_request_id   text DEFAULT NULL
) RETURNS public.guardian_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_row          public.guardian_links;
  v_student_name text;
BEGIN
  IF p_guardian_id = p_student_id THEN
    RAISE EXCEPTION 'guardian and student must differ' USING ERRCODE = '22023';
  END IF;

  -- Edge case 2: already linked is a 409, not a duplicate row. Only 'active' is
  -- checked because SCL-080 leaves no reachable pending status.
  IF EXISTS (
    SELECT 1 FROM public.guardian_links
     WHERE guardian_profile_id = p_guardian_id
       AND student_profile_id  = p_student_id
       AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'link already exists' USING ERRCODE = 'LY004';
  END IF;

  INSERT INTO public.guardian_links
    (guardian_profile_id, student_profile_id, status, initiated_by, initiated_at,
     accepted_at, accepted_by_profile_id)
  VALUES (p_guardian_id, p_student_id, 'active', 'student', now(), now(), p_student_id)
  RETURNING * INTO v_row;

  -- initiated_by='student' and accepted_by=the student: the student issued and shared the
  -- code, so the student is both the initiator and the consenting party. Recording the
  -- guardian as initiator would misattribute the consent.
  PERFORM public.guardian_link_audit(
    'guardian_link_initiated', p_student_id, p_guardian_id,
    jsonb_build_object('from', NULL, 'to', 'active', 'via', 'student_link_code'),
    v_row.id, p_request_id
  );

  -- Doc 01 §36.1 step 6 — both parties notified, in THIS transaction (contract §2.2).
  -- Student: in_app. Guardian: in_app + email. Payload: link_id and the student's display
  -- name only (contract §8.1; Doc 01 §38.1/§38.2 — nothing beyond identity to a guardian).
  SELECT display_name INTO v_student_name FROM public.profiles WHERE id = p_student_id;
  PERFORM public.emit_notification_event(
    public.notification_event_id('guardian_linked', v_row.id::text),
    'guardian_linked',
    p_student_id,
    jsonb_build_array(
      jsonb_build_object('profile_id', p_student_id,  'channels', jsonb_build_array('in_app')),
      jsonb_build_object('profile_id', p_guardian_id, 'channels', jsonb_build_array('in_app', 'email'))
    ),
    jsonb_build_object('link_id', v_row.id, 'student_display_name', coalesce(v_student_name, ''))
  );

  RETURN v_row;
END;
$fn$;

COMMIT;
