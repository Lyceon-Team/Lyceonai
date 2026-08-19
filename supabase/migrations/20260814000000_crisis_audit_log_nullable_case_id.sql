-- LYCEON-MIGRATION-REVIEWED
-- @spec [SCL-025]
-- @implemented 2026-08-14
--
-- plain English: Makes case_id and conversation_id nullable on
-- crisis_review_audit_log to support aggregate read audit entries (list cases,
-- SLA breach sweep, audit trail view). SCL-025 mandates "every read logged
-- append-only" — including list/sweep operations that don't target a single
-- case. These operations have no valid case_id or conversation_id to reference,
-- but the audit row is still required.
--
-- expected outcome: writeAuditLogEntry can be called with case_id = NULL and/or
-- conversation_id = NULL for aggregate operations. Single-case operations still
-- pass valid IDs. The FK constraint on case_id remains for non-null values.
--
-- trade-offs: NULL case_id means the audit log entry cannot be joined to a
-- specific case. The metadata JSONB column carries the surface and filter
-- details that identify what was accessed. This is acceptable because the
-- audit requirement is about proving who accessed the review surface and when,
-- not linking every access to a single case.
--
-- ROLLBACK:
--   ALTER TABLE public.crisis_review_audit_log ALTER COLUMN case_id SET NOT NULL;
--   ALTER TABLE public.crisis_review_audit_log ALTER COLUMN conversation_id SET NOT NULL;

ALTER TABLE public.crisis_review_audit_log ALTER COLUMN case_id DROP NOT NULL;
ALTER TABLE public.crisis_review_audit_log ALTER COLUMN conversation_id DROP NOT NULL;
