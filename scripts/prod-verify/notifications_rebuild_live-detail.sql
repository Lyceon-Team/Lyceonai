-- ===========================================================================
-- NOTIFICATIONS REBUILD — LIVE EVENT DETAIL (after a real guardian link-code redemption)
-- ===========================================================================
-- READ-ONLY listing. Paste into the Supabase SQL editor and run. One statement, one grid.
--
-- @spec [contracts/notifications.contract.md C2.2 (fan-out), C4 (status lifecycle),
--        C7 (delivery events); Doc-01_V8 §36.1 step 6] | @implemented [2026-09-03]
--
-- plain English: the most recent notification event, every message it fanned out to,
-- and every provider delivery event that reconciled against those messages, as one
-- grid. Expected after a redemption, before Resend calls back: the student's in_app
-- row and the guardian's in_app row `delivered`, the guardian's email row `sent` with
-- a `re_…` provider id and attempts = 1. After `email.delivered` arrives: the email
-- row `delivered` with delivered_at set, and one delivery-event row `applied`.
-- Payload shows link_id and student_display_name only (C8.1).
-- This file lists; the decision file is notifications_rebuild_verify.sql.
-- ===========================================================================

SELECT
    e.event_type,
    e.subject_profile_id,
    e.payload,
    e.created_at              AS event_created_at,
    m.recipient_profile_id,
    m.channel,
    m.status,
    m.attempts,
    m.last_error,
    m.provider_message_id,
    m.sent_at,
    m.delivered_at,
    d.provider_event_id,
    d.event_type              AS delivery_event_type,
    d.outcome                 AS delivery_outcome,
    d.applied_at
FROM public.notification_events e
LEFT JOIN public.notification_messages m
       ON m.event_id = e.event_id
LEFT JOIN public.notification_delivery_events d
       ON d.message_id = m.message_id
WHERE e.event_id = (
    SELECT event_id FROM public.notification_events
    ORDER BY created_at DESC LIMIT 1
)
ORDER BY m.channel, m.recipient_profile_id, d.received_at;
