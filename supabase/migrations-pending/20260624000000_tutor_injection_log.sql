-- ============================================================================
-- tutor_injection_log — LISA output-scanner forensic detail (safety-review queue)
-- ============================================================================
-- @spec [Doc-03A_V3 §18.7 (canonical CREATE TABLE), §17.3 180-day retention; Doc-03B_V4.1 §16.4
--   scanner fail behavior — "Log the incident to tutor_injection_log with detection_layer =
--   'layer_4_output'"; INV-03-13 silent handling; lyceon-coding-standards §12 privacy]
-- @implemented [2026-06-24]
-- plain English: LISA-specific forensic ledger written WHEN the output scanner (or an input
--   sanitization layer) blocks/substitutes a response. It is NOT the platform abuse ledger
--   (01A §55 abuse_score_incidents owns that) — it exists for the safety-review queue's
--   detailed evidence (signature matched, detection layer, action taken, the SUBSTITUTED safe
--   response). PRIVACY: response_substituted stores the safe fallback that WAS delivered, never
--   the blocked/leaking content — the blocked content never reaches this table (§16.4 "Persist
--   the SUBSTITUTED response, not the blocked one"). Service-role-only RLS; students never see
--   the injection log (INV-03-13).
--
-- SCOPE: this migration creates the table + indexes + service-role RLS exactly per the locked
--   §18.7 schema. The first writer is the layer_4 output-scanner block in
--   server/routes/tutor-runtime.ts (GAP-TU-05). Emission from the input sanitization layers
--   (layer_1..3) and the dual-write to abuse_score_incidents (01A Part VI) remain future work.
--
-- PENDING / OWNER-RUN: staged in supabase/migrations-pending/ — NOT in the active
--   supabase/migrations/ pipeline, so the CI fresh-apply gate + the committed
--   scripts/ci/genesis-schema.expected.sql snapshot do not drift. The table's FKs reference the
--   LISA runtime tables (tutor_conversations, tutor_messages) + profiles, which are NOT in
--   00000000000000_genesis.sql (they reached prod via the same out-of-band tutor-schema apply);
--   activating this on top of bare genesis would fail those FKs, so it MUST stay sibling-staged
--   until applied against an environment that already has the tutor runtime tables. To activate:
--   git mv into supabase/migrations/, regenerate scripts/ci/genesis-schema.expected.sql, apply.
--
-- IDEMPOTENT: CREATE TABLE/INDEX IF NOT EXISTS + DROP-then-CREATE POLICY — safe to re-apply and
--   safe whether or not the table already exists from the out-of-band tutor-schema apply.
--
-- ROLLBACK (INV-06: every-migration-has-rollback): reversible. The DOWN block drops the table;
--   its policy + indexes drop with it. CREATE-only / additive. LYCEON-MIGRATION-REVIEWED
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- tutor_injection_log — one row per blocked/substituted detection event.
--   Columns are the locked Doc-03A V3 §18.7 set — do not add or rename.
--   * detection_layer: 'layer_3_sanitization' | 'layer_4_output' | ... (free text per spec).
--   * action_taken: what the runtime did (e.g. 'silent_substitute').
--   * response_substituted: the SAFE fallback that was delivered (never the blocked content).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tutor_injection_log (
  id                    uuid          NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id       uuid          REFERENCES public.tutor_conversations(id) ON DELETE SET NULL,
  student_id            uuid          REFERENCES public.profiles(id) ON DELETE RESTRICT,
  message_id            uuid          REFERENCES public.tutor_messages(id) ON DELETE SET NULL,
  signature_matched     text          NULL,
  detection_layer       text          NOT NULL,
  action_taken          text          NOT NULL,
  response_substituted  text          NULL,
  detected_at           timestamptz   NOT NULL DEFAULT now()
);

-- Safety-review recency scan, per student (§18.7).
CREATE INDEX IF NOT EXISTS idx_tutor_injection_log_student_recent
  ON public.tutor_injection_log (student_id, detected_at DESC);

-- Signature-pattern analysis over time (§18.7).
CREATE INDEX IF NOT EXISTS idx_tutor_injection_log_signature
  ON public.tutor_injection_log (signature_matched, detected_at DESC);

-- ----------------------------------------------------------------------------
-- RLS — service-role-only. Students never see the injection log (INV-03-13). No
-- anon/authenticated policy: absence of policy is the denial.
-- ----------------------------------------------------------------------------
ALTER TABLE public.tutor_injection_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.tutor_injection_log FROM PUBLIC;
GRANT ALL ON public.tutor_injection_log TO service_role;

DROP POLICY IF EXISTS tutor_injection_log_service_role ON public.tutor_injection_log;
CREATE POLICY tutor_injection_log_service_role ON public.tutor_injection_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;

-- ============================================================================
-- DOWN (reversible). Dropping the table drops its policy + indexes with it.
-- No data beyond this table is touched.
-- ============================================================================
-- BEGIN;
--   DROP TABLE IF EXISTS public.tutor_injection_log;
-- COMMIT;
